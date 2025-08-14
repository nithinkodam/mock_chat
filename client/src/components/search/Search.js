import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { getSocket } from '../socket';

const Search = () => {
  const token = localStorage.getItem('token');
  const { username } = useParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [me, setMe] = useState(null); // { username, friends: [{name, messages:[]}, ...], requests: [...] }
  const [sentRequests, setSentRequests] = useState([]); // usernames we've sent requests to this session
  const navigate = useNavigate();

  // Fetch current user info
  const fetchMe = async () => {
    if (!token) return;
    try {
      const res = await axios.get('http://localhost:8000/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMe(res.data);
    } catch (err) {
      console.error('Failed to fetch /me', err);
    }
  };

  useEffect(() => {
    fetchMe();

    // Socket listener: if someone accepted request and backend emits "friend:added" to us,
    // add that friend to our me.friends so UI changes to "Already a friend".
    const socket = getSocket(token);
    if (!socket) return;
    const onFriendAdded = ({ friendUsername }) => {
      setMe(prev => {
        if (!prev) return prev;
        // if already friend, do nothing
        if ((prev.friends || []).some(f => f.name === friendUsername)) return prev;
        return {
          ...prev,
          friends: [...(prev.friends || []), { name: friendUsername, messages: [] }]
        };
      });
      // If we had a pending sentRequests mark, remove it (since now it's a friend)
      setSentRequests(prev => prev.filter(u => u !== friendUsername));
    };
    socket.on('friend:added', onFriendAdded);

    return () => {
      socket.off('friend:added', onFriendAdded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Debounced search
  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      axios.get(`http://localhost:8000/users/search`, {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => setResults(res.data))
        .catch(err => {
          console.error('Search failed', err);
          setResults([]);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token]);

  const sendRequest = async (targetUsername) => {
    if (!token) return;
    // Prevent sending request to yourself
    if (me?.username === targetUsername) return;

    try {
      await axios.post(`http://localhost:8000/requests`, {
        toUsername: targetUsername
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Optimistically mark as sent for UI
      setSentRequests(prev => (prev.includes(targetUsername) ? prev : [...prev, targetUsername]));

      // Optionally notify server via socket too (backend already emits from REST endpoint,
      // but emitting here won't hurt if you also have socket flow)
      const socket = getSocket(token);
      if (socket && me?.username) {
        try {
          socket.emit('friend_request_sent', { sender_username: me.username, receiver_username: targetUsername });
        } catch (err) {
          // ignore socket errors
        }
      }

      // Optionally re-fetch /me if you want to show incoming requests (not necessary for "request sent")
      // await fetchMe();

    } catch (err) {
      console.error('Request failed', err);
      alert("Failed to send friend request");
    }
  };

  // helpers
  const isFriend = (otherUsername) => {
    if (!me) return false;
    return (me.friends || []).some(f => f.name === otherUsername);
  };

  const alreadySent = (otherUsername) => {
    return sentRequests.includes(otherUsername);
  };

  return (
    <div>
      <div className="p-4">
        <input
          type="text"
          placeholder="Search users..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="border rounded px-3 py-2 w-full mb-4"
        />
        {results.map(u => {
          // skip showing current user as "Request" (show "You")
          const isYou = me && me.username === u.username;
          const friend = isFriend(u.username);
          const sent = alreadySent(u.username);

          return (
            <div key={u.email} className="flex justify-between items-center p-2 border-b">
              <img
                src={u.profile ? `data:image/*;base64,${u.profile}` : 'https://via.placeholder.com/80'}
                alt="pf"
                className="w-20 h-20 rounded-full"
              />
              <span style={{ fontSize: 20 }}><b>{u.username}</b></span>

              <div>
                {isYou ? (
                  <span className="text-gray-500 px-3 py-1 rounded">You</span>
                ) : friend ? (
                  <span className="text-green-700 px-3 py-1 rounded">Already a friend</span>
                ) : sent ? (
                  <span className="text-indigo-700 px-3 py-1 rounded">Request sent</span>
                ) : (
                  <button
                    onClick={() => sendRequest(u.username)}
                    className="bg-indigo-600 text-white px-3 py-1 rounded"
                  >
                    Request
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white shadow-inner flex justify-around p-3">
        <button onClick={() => navigate(`/${username}/chats`)}>Chats</button>
        <button onClick={() => navigate(`/${username}/search`)}>Search</button>
        <button onClick={() => navigate(`/${username}/profile`)}>Profile</button>
      </footer>
    </div>
  );
};

export default Search;
