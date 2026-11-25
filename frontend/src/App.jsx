import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import CambiarPassword from './pages/CambiarPassword';
import Productos from './pages/Productos';
import ListasPrecios from './pages/ListasPrecios';
import Existencias from './pages/Existencias';
import Compras from './pages/Compras';
import Proveedores from './pages/Proveedores';

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
            <Route path="/productos" element={<Productos />} />
            <Route path="/listas-precios" element={<ListasPrecios />} />
            <Route path="/existencias" element={<Existencias />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/proveedores" element={<Proveedores />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </AuthProvider>
  );
}
