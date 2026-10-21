import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Camps from './pages/Camps.jsx';
import CampDetail from './pages/CampDetail.jsx';
import Inventory from './pages/Inventory.jsx';
import Dispatches from './pages/Dispatches.jsx';
import Donations from './pages/Donations.jsx';
import Volunteers from './pages/Volunteers.jsx';

function NotFound() {
  return (
    <div className="empty">
      <p className="empty-title">That page does not exist</p>
      <p className="empty-text"><Link to="/">Go to the dashboard</Link></p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="camps" element={<Camps />} />
        <Route path="camps/:id" element={<CampDetail />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="dispatches" element={<Dispatches />} />
        <Route path="donations" element={<Donations />} />
        <Route path="volunteers" element={<Volunteers />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
