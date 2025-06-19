import {BrowserRouter,Route,Routes} from 'react-router-dom'
import './App.css';
import Chats from './components/chats/Chats'
import Search from './components/search/Search';
import Profile from './components/profile/Profile';
import Signup from './components/signup/Signup';
import Signin from './components/signin/Signin';
import Notifications from './components/notifications/Notifications';
import ChatPage from './components/chatpage/ChatPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Signin/>} />
        <Route path='/:username/chats' element={<Chats/>} />
        <Route path='/:username/search' element={<Search/>} />
        <Route path='/:username/profile' element={<Profile/>} />
        <Route path='/:username/chat/:friend' element={<ChatPage/>} />
        <Route path='/signup' element={<Signup/>} />
        <Route path='/signin' element={<Signin/>} />
        <Route path='/:username/notifications' element={<Notifications/>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
