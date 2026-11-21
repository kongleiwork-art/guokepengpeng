import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { DollProfilePage } from './pages/DollProfilePage';
import { DollChatPage } from './pages/DollChatPage';
import { CreatePage } from './pages/CreatePage';
import { ProcessingPage } from './pages/ProcessingPage';
import { CardDetailPage } from './pages/CardDetailPage';
import { MyWorksPage } from './pages/MyWorksPage';
import { DevAdminPage } from './pages/DevAdminPage';
import { installMobileLongPressFeedback } from './lib/longPress';

export default function App() {
  useEffect(() => {
    return installMobileLongPressFeedback();
  }, []);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/d/:dollId" element={<DollProfilePage />} />
          <Route path="/d/:dollId/chat" element={<DollChatPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/create/processing" element={<ProcessingPage />} />
          <Route path="/card/:cardId" element={<CardDetailPage />} />
          <Route path="/works" element={<MyWorksPage />} />
          <Route path="/dev" element={<DevAdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
