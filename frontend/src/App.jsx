import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import CambiarPassword from './pages/CambiarPassword';

function Inicio() {
  const { usuario, sucursalActiva } = useAuth();
  const sucursal = usuario.sucursales.find(s => s.id === sucursalActiva);
  return (
    <section>
      <h2 className="text-lg font-semibold">Hola, {usuario.nombre}</h2>
      <p className="text-slate-600">Trabajando en: {sucursal ? sucursal.nombre : 'ninguna sucursal'}</p>
    </section>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/cambiar-password" element={<CambiarPassword />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </AuthProvider>
  );
}
