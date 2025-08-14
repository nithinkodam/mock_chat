import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../socket';
import defaultImage from '../chatpage/default_avatar.png'

const Chats = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [user, setUser] = useState({});
  const [chatList, setChatList] = useState([]);
  const [requestsCount, setRequestsCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [usersMap, setUsersMap] = useState({}); // username -> dataURI or null

  const fetchAllUsersToMap = async (signal) => {
    if (!token) return {};
    try {
      const usersRes = await axios.get('http://localhost:8000/users', {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const map = {};
      usersRes.data.forEach(u => {
        if (u.username) {
          map[u.username] = u.profile ? `data:image/*;base64,${u.profile}` : null;
        }
      });
      return map;
    } catch (err) {
      // If request aborted or fails, return empty map
      return {};
    }
  };

  const fetchProfileForUser = async (username) => {
    if (!token || !username) return null;
    try {
      const res = await axios.get(`http://localhost:8000/him?name=${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const profile = res.data?.profile ?? "";
      return profile ? `data:image/*;base64,${profile}` : null;
    } catch (err) {
      console.error('Failed to fetch profile for', username, err);
      return null;
    }
  };

  const fetchChatList = async () => {
    if (!token) return;
    try {
      // Get current user
      const res = await axios.get('http://localhost:8000/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const currentUser = res.data;
      setUser(currentUser);

      // Get chat list
      const chatsRes = await axios.get(`http://localhost:8000/${currentUser.username}/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setChatList(chatsRes.data || []);

      // Get notification count
      const notifRes = await axios.get('http://localhost:8000/notifications/count', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRequestsCount(notifRes.data?.count ?? 0);

      // Fetch all users (for profile images) and set usersMap
      const map = await fetchAllUsersToMap();
      setUsersMap(map);
    } catch (err) {
      console.error('Error fetching data', err);
    }
  };

  useEffect(() => {
    fetchChatList();

    const handleFocus = () => {
      if (!document.hidden) fetchChatList();
    };
    document.addEventListener('visibilitychange', handleFocus);
    return () => document.removeEventListener('visibilitychange', handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Real-time socket listeners
  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    if (!socket) return;

    if (user?.username) {
      socket.emit('user_connected', { username: user.username });
    }

    // Incoming message -> bump unseen + reorder
    const onNewMessage = ({ from, to }) => {
      if (!user?.username || to !== user.username) return;
      setChatList(prev => {
        const found = prev.find(c => c.friendUsername === from);
        if (!found) {
          return [{ friendUsername: from, unseenCount: 1 }, ...prev];
        }
        const updated = prev.map(c =>
          c.friendUsername === from ? { ...c, unseenCount: (c.unseenCount || 0) + 1 } : c
        );
        const moved = [
          updated.find(c => c.friendUsername === from),
          ...updated.filter(c => c.friendUsername !== from)
        ];
        return moved;
      });
    };

    // Server-driven unseen counter update
    const onUnseenUpdate = ({ friendUsername, unseenCount }) => {
      setChatList(prev => {
        const exists = prev.some(c => c.friendUsername === friendUsername);
        const updated = exists
          ? prev.map(c => (c.friendUsername === friendUsername ? { ...c, unseenCount } : c))
          : [{ friendUsername, unseenCount }, ...prev];
        return updated;
      });
    };

    // Notifications count
    const onNotifCount = ({ count }) => setRequestsCount(count ?? 0);

    // Friend added: append to chat list and fetch profile for that friend
    const onFriendAdded = async ({ friendUsername }) => {
      setChatList(prev => {
        if (prev.some(c => c.friendUsername === friendUsername)) return prev;
        return [{ friendUsername, unseenCount: 0 }, ...prev];
      });
      // fetch their profile and add to usersMap
      const profileDataUri = await fetchProfileForUser(friendUsername);
      setUsersMap(prev => ({ ...prev, [friendUsername]: profileDataUri }));
    };

    // Profile updated: server broadcasts { username, profile } (profile is base64 string)
    const onProfileUpdated = ({ username, profile }) => {
      // convert base64 to dataURI or null
      const uri = profile ? `data:image/*;base64,${profile}` : null;
      setUsersMap(prev => ({ ...prev, [username]: uri }));
    };

    // New user created: server broadcasts { username, profile }
    const onUserCreated = ({ username, profile }) => {
      const uri = profile ? `data:image/*;base64,${profile}` : null;
      setUsersMap(prev => ({ ...prev, [username]: uri }));
    };

    socket.on('message:new', onNewMessage);
    socket.on('chat:unseen_update', onUnseenUpdate);
    socket.on('notifications:count', onNotifCount);
    socket.on('friend:added', onFriendAdded);
    socket.on('profile:updated', onProfileUpdated);
    socket.on('user:created', onUserCreated);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('chat:unseen_update', onUnseenUpdate);
      socket.off('notifications:count', onNotifCount);
      socket.off('friend:added', onFriendAdded);
      socket.off('profile:updated', onProfileUpdated);
      socket.off('user:created', onUserCreated);
    };
  }, [token, user?.username]);

  const onNotifications = () => navigate(`/${user.username}/notifications`);
  const goSearch = () => navigate(`/${user.username}/search`);
  const goProfile = () => navigate(`/${user.username}/profile`);
  const openChat = (friendUsername) => navigate(`/${user.username}/chat/${friendUsername}`);

  const filteredChats = useMemo(
    () => (chatList || []).filter(c =>
      (c.friendUsername || '').toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [chatList, searchQuery]
  );

  return (
    <div className="container flex flex-col h-screen">
      <header className="flex items-center justify-between p-4 bg-white shadow fixed top-0 left-0 right-0 z-10">
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="border rounded px-3 py-2 w-full max-w-md"
        />
        <div className="relative ml-4">
          <button onClick={onNotifications} className="relative text-xl">
            🔔
            {requestsCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-1">
                {requestsCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto mt-20 mb-16 px-4">
        {filteredChats.length === 0 && (
          <div className="text-center text-gray-400 mt-10">No chats found</div>
        )}
        {filteredChats.map(c => {
          const friendImage = usersMap[c.friendUsername] || defaultImage;
          return (
            <div
              key={c.friendUsername}
              className="flex justify-between items-center p-3 hover:bg-gray-100 rounded cursor-pointer"
              onClick={() => openChat(c.friendUsername)}
            >
              <div className="flex items-center">
                <img
                  src={friendImage}
                  alt={c.friendUsername}
                  className="w-10 h-10 rounded-full object-cover mr-3"
                />
                <div className="text-lg font-medium">{c.friendUsername}</div>
              </div>
              {c.unseenCount > 0 && (
                <span className="bg-indigo-600 text-white rounded-full px-2 text-sm">
                  {c.unseenCount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white shadow-inner flex justify-around p-3">
        <button onClick={() => navigate(`/${user.username}/chats`)} className="flex flex-col items-center">
          Chats
        </button>
        <button onClick={goSearch} className="flex flex-col items-center">
          Search
        </button>
        <button onClick={goProfile} className="flex flex-col items-center">
          Profile
        </button>
      </footer>
    </div>
  );
};

export default Chats;
