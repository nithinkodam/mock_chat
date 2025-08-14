import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { initSocket } from '../socket';

const Signin = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await axios.post('https://mock-chat-backend.onrender.com/signin', formData);
      const token = res.data.access_token;
      localStorage.setItem('token', token);

      const r = await axios.get('https://mock-chat-backend.onrender.com/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const username = r.data.username;

      const socket = initSocket(token);
      socket.emit("user_connected", { username });

      navigate(`/${username}/chats`);
    } catch (err) {
      console.error('Login failed', err);
      setError("Invalid email or password");
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col justify-center px-6 py-12 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-sm">
        <img
          alt="Your Company"
          src="https://thumbs.dreamstime.com/b/chat-icon-13470621.jpg"
          className="mx-auto h-20 w-auto"
        />
        <h2 className="mt-10 text-center text-2xl font-bold tracking-tight text-gray-900">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-900">Email address</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="block w-full rounded-md px-3 py-1.5 outline outline-1 outline-gray-300 focus:outline-2 focus:outline-indigo-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900">Password</label>
            <input
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="block w-full rounded-md px-3 py-1.5 outline outline-1 outline-gray-300 focus:outline-2 focus:outline-indigo-600"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Sign in
          </button>
        </form>

        <p className="mt-10 text-center text-sm text-gray-500">
          Not a member?{' '}
          <a href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500">
            Signup
          </a>
        </p>
      </div>
    </div>
  );
};

export default Signin;
