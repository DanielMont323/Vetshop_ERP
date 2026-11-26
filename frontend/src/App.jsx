import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DialogoProvider } from './contexts/DialogoContext';
import Layout from './components/Layout';
import Protegida from './components/Protegida';
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
import Facturas from './pages/Facturas';
import Autofactura from './pages/Autofactura';
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
          <Route path="/autofactura" element={<Autofactura />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/cambiar-password" element={<><CambiarPassword /><MiPin /></>} />
            <Route path="/administracion" element={<Protegida permisos={['usuarios:gestionar','sucursales:gestionar','clientes:gestionar']}><Administracion /></Protegida>} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/listas-precios" element={<ListasPrecios />} />
            <Route path="/existencias" element={<Protegida permisos={['existencias:ver']}><Existencias /></Protegida>} />
            <Route path="/compras" element={<Protegida permisos={['recepcion:registrar']}><Compras /></Protegida>} />
            <Route path="/proveedores" element={<Protegida permisos={['recepcion:registrar']}><Proveedores /></Protegida>} />
            <Route path="/caja" element={<Protegida permisos={['ventas:cobrar']}><Caja /></Protegida>} />
            <Route path="/ventas" element={<Protegida permisos={['ventas:ver_todas','ventas:ver_propias_del_dia']}><VentasDia /></Protegida>} />
            <Route path="/recetas" element={<Protegida permisos={['recetas:capturar']}><Recetas /></Protegida>} />
            <Route path="/corte" element={<Protegida permisos={['corte:capturar_conteo','turnos:ver_todos']}><Corte /></Protegida>} />
            <Route path="/traspasos" element={<Protegida permisos={['traspasos:gestionar']}><Traspasos /></Protegida>} />
            <Route path="/reportes" element={<Protegida permisos={['reportes:ver']}><Reportes /></Protegida>} />
            <Route path="/cobranza" element={<Protegida permisos={['cobranza:ver','cobranza:registrar_abono']}><Cobranza /></Protegida>} />
            <Route path="/cuentas-por-pagar" element={<Protegida permisos={['cuentas_pagar:gestionar']}><CuentasPorPagar /></Protegida>} />
            <Route path="/conteos" element={<Protegida permisos={['conteo_fisico:capturar']}><Conteos /></Protegida>} />
            <Route path="/cadena-frio" element={<Protegida permisos={['cadena_frio:capturar']}><CadenaFrio /></Protegida>} />
            <Route path="/compras-sugeridas" element={<Protegida permisos={['recepcion:registrar']}><ComprasSugeridas /></Protegida>} />
            <Route path="/metas" element={<Protegida permisos={['reportes:ver']}><Metas /></Protegida>} />
            <Route path="/facturas" element={<Protegida permisos={['facturacion:emitir']}><Facturas /></Protegida>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
      </DialogoProvider>
    </AuthProvider>
  );
}
