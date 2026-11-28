import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import { ArrowLeftRight, BadgePercent, BarChart3, Bell, BookUser, ClipboardList, HandCoins, Landmark, Receipt, Thermometer, Settings, Boxes, Calculator, FileText, KeyRound, LogOut, Package, PawPrint, ReceiptText, ShoppingCart, Store, Tags, Truck, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const NOMBRES_ROL = {
  cajero: 'Cajero',
  almacen: 'Almacén',
  medico_responsable: 'Médico responsable',
  dueno: 'Dueño'
};

// Marco de las pantallas con sesión: encabezado con usuario, selector de sucursal y salir.
export default function Layout() {
  const { usuario, cargando, sucursalActiva, elegirSucursal, cerrarSesion, puede } = useAuth();

  if (cargando) return <p className="p-6 text-slate-500">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4">
          <Link to="/" className="flex items-center gap-2 text-emerald-700 font-semibold">
            <PawPrint size={20} aria-hidden="true" /> Huellitas Vetshop
          </Link>

          {puede('catalogo:ver') && (
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              {[
                puede('reportes:ver') && ['/reportes', 'Reportes', BarChart3],
                puede('ventas:cobrar') && ['/caja', 'Caja', ShoppingCart],
                puede('corte:capturar_conteo') && ['/corte', 'Turno y corte', Calculator],
                (puede('ventas:ver_todas') || puede('ventas:ver_propias_del_dia')) && ['/ventas', 'Ventas', ReceiptText],
                (puede('clientes:registrar') || puede('clientes:gestionar')) && ['/clientes', 'Clientes', BookUser],
                puede('clientes:registrar') && ['/recordatorios', 'Recordatorios', Bell],
                (puede('cobranza:ver') || puede('cobranza:registrar_abono')) && ['/cobranza', 'Cobranza', HandCoins],
                puede('facturacion:emitir') && ['/facturas', 'Facturas', Receipt],
                puede('recetas:capturar') && ['/recetas', 'Recetas', FileText],
                puede('existencias:ver') && ['/existencias', 'Existencias', Boxes],
                puede('recepcion:registrar') && ['/compras', 'Recepción', Truck],
                puede('traspasos:gestionar') && ['/traspasos', 'Traspasos', ArrowLeftRight],
                puede('conteo_fisico:capturar') && ['/conteos', 'Conteo', ClipboardList],
                puede('cadena_frio:capturar') && ['/cadena-frio', 'Frío', Thermometer],
                puede('recepcion:registrar') && ['/proveedores', 'Proveedores', Users],
                puede('cuentas_pagar:gestionar') && ['/cuentas-por-pagar', 'Por pagar', Landmark],
                ['/productos', 'Productos', Package],
                ['/listas-precios', 'Precios', Tags],
                ['/promociones', 'Promociones', BadgePercent],
                puede('usuarios:gestionar') && ['/administracion', 'Administración', Settings]
              ].filter(Boolean).map(([ruta, texto, Icono]) => (
                <NavLink
                  key={ruta}
                  to={ruta}
                  className={({ isActive }) => `flex items-center gap-1 rounded-lg px-2 py-1 ${isActive ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Icono size={16} aria-hidden="true" /> {texto}
                </NavLink>
              ))}
            </nav>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Store size={16} aria-hidden="true" />
            <span className="sr-only">Sucursal</span>
            <select
              className="rounded-lg border border-slate-300 px-2 py-1"
              value={sucursalActiva || ''}
              onChange={e => elegirSucursal(e.target.value)}
            >
              {usuario.sucursales.length === 0 && <option value="">Sin sucursales</option>}
              {usuario.sucursales.map(s => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span>
              {usuario.nombre} <span className="text-slate-500">· {NOMBRES_ROL[usuario.rol]}</span>
            </span>
            <Link to="/cambiar-password" className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
              <KeyRound size={16} aria-hidden="true" /> Contraseña
            </Link>
            <button type="button" onClick={cerrarSesion} className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
              <LogOut size={16} aria-hidden="true" /> Salir
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
