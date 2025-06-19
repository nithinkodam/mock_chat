// Signin.js
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client'; // ✅ socket.io-client import

const Signin = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await axios.post('http://localhost:8000/signin', formData);
      localStorage.setItem('token', res.data.access_token);

      const token = localStorage.getItem('token');
      const r = await axios.get('http://localhost:8000/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      const username = r.data.username;

      // ✅ Initialize socket connection
      const socket = io("http://localhost:8000", {
        auth: {
          token
        }
      });

      // ✅ Optionally attach socket globally (you may later move to context)
      window.socket = socket;

      // ✅ Join user's personal room or notify server
      socket.emit("user_connected", { username });

      // ✅ Navigate to chats
      navigate(`/${username}/chats`);
    } catch (err) {
      setError("Invalid email or password");
    }
  };

  return (
    <div>
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
              <label htmlFor="email" className="block text-sm font-medium text-gray-900">
                Email address
              </label>
              <div className="mt-2">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="block w-full rounded-md px-3 py-1.5 text-base outline outline-1 outline-gray-300 focus:outline-2 focus:outline-indigo-600 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-900">
                Password
              </label>
              <div className="mt-2">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="block w-full rounded-md px-3 py-1.5 text-base outline outline-1 outline-gray-300 focus:outline-2 focus:outline-indigo-600 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Sign in
              </button>
            </div>
          </form>

          <p className="mt-10 text-center text-sm text-gray-500">
            Not a member?{' '}
            <a href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500">
              Signup
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signin;
