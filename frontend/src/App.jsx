import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DialogoProvider } from './contexts/DialogoContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import CambiarPassword, { MiPin } from './pages/CambiarPassword';
import Administracion from './pages/Administracion';
import Productos from './pages/Productos';
import ListasPrecios from './pages/ListasPrecios';
import Existencias from './pages/Existencias';
import Compras from './pages/Compras';
import Proveedores from './pages/Proveedores';
import Caja from './pages/Caja';
import VentasDia from './pages/VentasDia';
import Recetas from './pages/Recetas';
import Corte from './pages/Corte';
import Traspasos from './pages/Traspasos';
import Dashboard from './pages/Dashboard';
import Reportes from './pages/Reportes';
import Cobranza from './pages/Cobranza';
import CuentasPorPagar from './pages/CuentasPorPagar';
import Conteos from './pages/Conteos';
import CadenaFrio from './pages/CadenaFrio';
import ComprasSugeridas from './pages/ComprasSugeridas';
import Metas from './pages/Metas';
import MiAvance from './components/metas/MiAvance';

function Inicio() {
  const { usuario, sucursalActiva, puede } = useAuth();
  if (puede('reportes:ver')) return <Dashboard />;
  const sucursal = usuario.sucursales.find(s => s.id === sucursalActiva);
  return (
    <section>
      <h2 className="text-lg font-semibold">Hola, {usuario.nombre}</h2>
      <p className="text-slate-600">Trabajando en: {sucursal ? sucursal.nombre : 'ninguna sucursal'}</p>
      {puede('ventas:cobrar') && sucursal && <MiAvance />}
    </section>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DialogoProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/cambiar-password" element={<><CambiarPassword /><MiPin /></>} />
            <Route path="/administracion" element={<Administracion />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/listas-precios" element={<ListasPrecios />} />
            <Route path="/existencias" element={<Existencias />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/proveedores" element={<Proveedores />} />
            <Route path="/caja" element={<Caja />} />
            <Route path="/ventas" element={<VentasDia />} />
            <Route path="/recetas" element={<Recetas />} />
            <Route path="/corte" element={<Corte />} />
            <Route path="/traspasos" element={<Traspasos />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/cobranza" element={<Cobranza />} />
            <Route path="/cuentas-por-pagar" element={<CuentasPorPagar />} />
            <Route path="/conteos" element={<Conteos />} />
            <Route path="/cadena-frio" element={<CadenaFrio />} />
            <Route path="/compras-sugeridas" element={<ComprasSugeridas />} />
            <Route path="/metas" element={<Metas />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
      </DialogoProvider>
    </AuthProvider>
  );
}
