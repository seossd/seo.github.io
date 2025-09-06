import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, onSnapshot, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// Firestore 및 Firebase Auth 전역 변수 설정
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 익명 로그인 또는 커스텀 토큰 로그인
const handleAuth = async () => {
  try {
    if (typeof __initial_auth_token !== 'undefined') {
      await signInWithCustomToken(auth, __initial_auth_token);
    } else {
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.error("Firebase 인증 실패:", e);
  }
};

const App = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState(null);
  const [nickname, setNickname] = useState(null);
  const [targetId, setTargetId] = useState(null);
  const [targetNickname, setTargetNickname] = useState(null);
  const [userList, setUserList] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [theme, setTheme] = useState('light');
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const messagesEndRef = useRef(null);

  // 인증 상태 변화 리스너 및 사용자 목록 로드
  useEffect(() => {
    handleAuth();
    const unsubscribeAuth = auth.onAuthStateChanged(async user => {
      if (user) {
        setUserId(user.uid);
        const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          setNickname(userDoc.data().nickname);
          fetchUserList();
        } else {
          setShowNicknameModal(true);
        }
      } else {
        setUserId(null);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // 메시지 데이터 실시간 리스너 및 '입력 중...' 상태 감지
  useEffect(() => {
    if (!userId || !targetId) {
      setMessages([]);
      return;
    }

    const q = query(collection(db, `/artifacts/${appId}/public/data/messages`));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const allMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const filteredMessages = allMessages.filter(msg => 
        (msg.senderId === userId && msg.receiverId === targetId) ||
        (msg.senderId === targetId && msg.receiverId === userId)
      ).sort((a, b) => a.timestamp - b.timestamp);

      setMessages(filteredMessages);

      // 타겟 닉네임 가져오기
      if (targetId) {
        const targetDocRef = doc(db, `/artifacts/${appId}/public/data/users`, targetId);
        const targetDoc = await getDoc(targetDocRef);
        if (targetDoc.exists()) {
          setTargetNickname(targetDoc.data().nickname);
        } else {
          setTargetNickname(targetId.substring(0, 8)); // 닉네임이 없으면 UID 일부 표시
        }
      }
    });

    // '입력 중...' 상태 리스너
    const typingDocRef = doc(db, `/artifacts/${appId}/public/data/typing`, targetId);
    const unsubscribeTyping = onSnapshot(typingDocRef, (doc) => {
      if (doc.exists() && doc.data().isTyping && doc.data().userId !== userId) {
        setIsTyping(true);
      } else {
        setIsTyping(false);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeTyping();
    };
  }, [userId, targetId]);

  // 메시지 전송 후 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 사용자 목록 불러오기 (Firestore 문서 ID 기반)
  const fetchUserList = async () => {
    const messagesCollection = collection(db, `/artifacts/${appId}/public/data/messages`);
    const messagesSnapshot = await getDocs(messagesCollection);
    
    const uids = new Set();
    messagesSnapshot.docs.forEach(doc => {
      const data = doc.data();
      uids.add(data.senderId);
      uids.add(data.receiverId);
    });

    const userListArray = Array.from(uids).filter(uid => uid !== userId);

    // UID를 닉네임으로 변환
    const usersWithNicknames = await Promise.all(
      userListArray.map(async (uid) => {
        const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          return { uid, nickname: userDoc.data().nickname };
        }
        return { uid, nickname: uid.substring(0, 8) }; // 닉네임이 없으면 UID 일부 사용
      })
    );
    setUserList(usersWithNicknames);
  };

  // '입력 중...' 상태 업데이트
  const handleTyping = async (isUserTyping) => {
    if (!userId || !targetId) return;
    try {
      const typingDocRef = doc(db, `/artifacts/${appId}/public/data/typing`, userId);
      await setDoc(typingDocRef, { userId, isTyping: isUserTyping }, { merge: true });
    } catch (e) {
      console.error("입력 중 상태 업데이트 실패:", e);
    }
  };

  // 닉네임 저장
  const saveNickname = async (e) => {
    e.preventDefault();
    if (newNickname.trim() === '') return;

    try {
      const userDocRef = doc(db, `/artifacts/${appId}/public/data/users`, userId);
      await setDoc(userDocRef, { nickname: newNickname });
      setNickname(newNickname);
      setShowNicknameModal(false);
      fetchUserList();
    } catch (e) {
      console.error("닉네임 저장 실패:", e);
    }
  };

  // 메시지 전송 핸들러
  const sendMessage = async (e) => {
    e.preventDefault();
    if (input.trim() === '' || !userId || !targetId) return;
    
    handleTyping(false);

    try {
      await addDoc(collection(db, `/artifacts/${appId}/public/data/messages`), {
        text: input,
        senderId: userId,
        receiverId: targetId,
        timestamp: Date.now(),
      });
      setInput('');
    } catch (e) {
      console.error("메시지 전송 실패:", e);
    }
  };

  // 테마 전환
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const mainBg = theme === 'light' ? 'bg-gray-50' : 'bg-gray-900 text-white';
  const chatBg = theme === 'light' ? 'bg-white' : 'bg-gray-800';
  const headerBg = theme === 'light' ? 'bg-white border-gray-200' : 'bg-gray-900 border-gray-700';
  const myBubble = theme === 'light' ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white';
  const otherBubble = theme === 'light' ? 'bg-gray-300 text-gray-800' : 'bg-gray-600 text-gray-200';
  const inputBg = theme === 'light' ? 'bg-white' : 'bg-gray-700 text-white placeholder-gray-400';
  const sidebarBg = theme === 'light' ? 'bg-gray-100 border-gray-200' : 'bg-gray-900 border-gray-700';
  const sidebarItemActive = theme === 'light' ? 'bg-blue-200 text-blue-800' : 'bg-blue-700 text-white';
  const sidebarItemHover = theme === 'light' ? 'hover:bg-gray-200' : 'hover:bg-gray-800';
  const typingText = theme === 'light' ? 'text-gray-500' : 'text-gray-400';
  const modalBg = theme === 'light' ? 'bg-white' : 'bg-gray-800 text-white';

  return (
    <div className={`flex flex-col h-screen font-sans antialiased transition-colors duration-500 ${mainBg}`}>
      <div className="flex-1 flex w-full max-w-4xl mx-auto rounded-lg shadow-2xl overflow-hidden">
        
        {/* 사이드바 - 대화 목록 */}
        <div className={`w-1/4 p-4 border-r ${sidebarBg}`}>
          <div className="flex justify-between items-center mb-4">
            <div className={`font-bold text-lg ${theme === 'dark' ? 'text-gray-100' : 'text-gray-800'}`}>채팅</div>
            <button onClick={toggleTheme} className="p-2 rounded-full transition-colors duration-300 hover:bg-gray-200 dark:hover:bg-gray-700">
              {theme === 'light' ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-700 dark:text-gray-300">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25c0 5.385 4.365 9.75 9.75 9.75 1.33 0 2.597-.266 3.752-.748z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-700 dark:text-gray-300">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.364l-1.554 1.554M21 12h-2.25m-.364 6.364l-1.554-1.554M12 18.75V21m-6.364-.364l1.554-1.554M3 12H5.25m.364-6.364l1.554 1.554M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
          <div className={`text-sm mb-4 truncate ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>내 닉네임: {nickname || '로딩 중...'}</div>
          <ul className="space-y-2">
            {userList.map(user => (
              <li 
                key={user.uid}
                className={`p-3 rounded-lg cursor-pointer transition-colors duration-200 ${targetId === user.uid ? sidebarItemActive : sidebarItemHover} ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}
                onClick={() => setTargetId(user.uid)}
              >
                {user.nickname}
              </li>
            ))}
          </ul>
        </div>

        {/* 메인 채팅창 */}
        <div className={`flex-1 flex flex-col ${chatBg}`}>
          <header className={`p-4 border-b ${headerBg} flex items-center justify-between`}>
            <h2 className={`text-lg font-semibold text-gray-800 ${theme === 'dark' ? 'text-white' : ''}`}>{targetNickname ? targetNickname : '대화 상대 선택'}</h2>
          </header>

          <main className="flex-1 p-6 overflow-y-auto space-y-4">
            {messages.length === 0 && !isTyping ? (
              <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
                {targetNickname ? `${targetNickname}님과 대화를 시작해보세요!` : '대화 상대방을 선택해 주세요.'}
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.senderId === userId ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`p-3 max-w-sm rounded-2xl shadow-sm ${
                      msg.senderId === userId
                        ? `${myBubble} rounded-br-none`
                        : `${otherBubble} rounded-bl-none`
                    }`}
                  >
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))
            )}
            {isTyping && (
              <div className="flex justify-start">
                <div className={`p-3 rounded-2xl ${otherBubble}`}>
                  <div className="flex space-x-1">
                    <div className={`w-2 h-2 rounded-full bg-gray-500 animate-bounce ${typingText}`}></div>
                    <div className={`w-2 h-2 rounded-full bg-gray-500 animate-bounce delay-150 ${typingText}`}></div>
                    <div className={`w-2 h-2 rounded-full bg-gray-500 animate-bounce delay-300 ${typingText}`}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </main>

          <form onSubmit={sendMessage} className={`p-4 border-t ${headerBg} flex items-center space-x-2`}>
            <input
              type="text"
              className={`flex-1 p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow disabled:bg-gray-100 ${inputBg} disabled:cursor-not-allowed`}
              placeholder="메시지 입력..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (e.target.value.length > 0) {
                  handleTyping(true);
                } else {
                  handleTyping(false);
                }
              }}
              disabled={!targetId}
            />
            <button
              type="submit"
              className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={!targetId}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.917H13.5a.75.75 0 010 1.5H4.984l-2.432 7.918a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </form>
        </div>
      </div>
      
      {/* 닉네임 설정 모달 */}
      {showNicknameModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center p-4">
          <div className={`p-8 rounded-lg shadow-lg max-w-md w-full ${modalBg}`}>
            <h2 className="text-xl font-bold mb-4">닉네임 설정</h2>
            <p className="mb-4">메신저에서 사용할 짧은 닉네임을 설정해주세요. 이 닉네임으로 다른 사용자와 대화할 수 있습니다.</p>
            <form onSubmit={saveNickname} className="flex flex-col space-y-4">
              <input
                type="text"
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="닉네임 입력..."
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
              />
              <button
                type="submit"
                className="bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                닉네임 저장
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
