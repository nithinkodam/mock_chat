// Search.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';

const Search = () => {
  const token = localStorage.getItem('token');
  const { username } = useParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const navigate = useNavigate();

  const goSearch = () => navigate(`/${username}/search`);
  const goProfile = () => navigate(`/${username}/profile`);

  useEffect(() => {
    if (query.trim() === '') return setResults([]);
    const timer = setTimeout(() => {
      axios.get(`http://localhost:8000/users/search`, {
        params: { q: query },
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => setResults(res.data));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token]);

  const sendRequest = async (targetUsername) => {
    try {
      await axios.post(`http://localhost:8000/requests`, {
        toUsername: targetUsername
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // ✅ Emit socket event
      if (window.socket) {
        window.socket.emit("friend_request_sent", {
          from: username,
          to: targetUsername
        });
      }

      alert("Friend request sent");
    } catch (err) {
      alert("Failed to send friend request");
    }
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
        {results.map(u => (
          <div key={u.email} className="flex justify-between items-center p-2 border-b">
            <img src={`data:image/*;base64,${u.profile}`} className="w-20 h-20 rounded-full" />
            <span style={{ fontSize: 35 }}><b>{u.username}</b></span>
            <button
              onClick={() => sendRequest(u.username)}
              className="bg-indigo-600 text-white px-3 py-1 rounded"
            >
              Request
            </button>
          </div>
        ))}
      </div>
      <footer className="fixed bottom-0 left-0 right-0 bg-white shadow-inner flex justify-around p-3">
        <button onClick={() => navigate(`/${username}/chats`)} className="flex flex-col items-center">
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

export default Search;
