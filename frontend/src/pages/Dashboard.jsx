import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, Calculator, CalendarClock, FileText, PackageX, TrendingDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { mensajeDeError, reportesAPI } from '../services/api';
import { formatearDinero } from '../utils/formato';
import GraficaBarras from '../components/reportes/GraficaBarras';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
// "2026-11-25" → "mar 25"
const etiquetaDia = ymd => {
  const [a, m, d] = ymd.split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${d}`;
};

function Tile({ titulo, valor, detalle }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{valor}</p>
      {detalle && <p className="text-xs text-slate-500 mt-1">{detalle}</p>}
    </div>
  );
}

// Alertas: icono + texto + número (nunca solo color)
const ALERTAS = [
  ['caducados', 'Productos con lotes caducados', PackageX, '/existencias'],
  ['porCaducar', 'Productos por caducar (30 días)', CalendarClock, '/existencias'],
  ['bajoMinimo', 'Productos bajo mínimo', TrendingDown, '/existencias'],
  ['cortesPendientes', 'Cortes con diferencia por autorizar', Calculator, '/corte'],
  ['cortesConDiferencia', 'Cortes cerrados con diferencia (7 días)', AlertTriangle, '/corte'],
  ['recetasPendientes', 'Recetas por validar', FileText, '/recetas'],
  ['traspasosPorRecibir', 'Traspasos por recibir', ArrowLeftRight, '/traspasos']
];

// Tablero del dueño: hoy, últimos 7 días y alertas de la sucursal activa
export default function Dashboard() {
  const { usuario, sucursalActiva } = useAuth();
  const [datos, setDatos] = useState(null);
  const sucursal = usuario.sucursales.find(s => s.id === sucursalActiva);

  useEffect(() => {
    setDatos(null);
    reportesAPI.dashboard().then(r => setDatos(r.data.datos)).catch(e => toast.error(mensajeDeError(e, 'No se pudo cargar el tablero')));
  }, [sucursalActiva]);

  if (!datos) return <p className="text-slate-500">Cargando…</p>;
  const { hoy, ultimos7, alertas } = datos;
  const activas = ALERTAS.filter(([clave]) => alertas[clave] > 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-semibold mr-auto">Hoy en {sucursal?.nombre || 'la sucursal'}</h2>
        <Link to="/reportes" className="text-sm text-emerald-700 underline">Ver reportes</Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile titulo="Ventas de hoy" valor={formatearDinero(hoy.total)} detalle={`IVA incluido · ${formatearDinero(hoy.iva)} de IVA`} />
        <Tile titulo="Tickets" valor={hoy.ventas} />
        <Tile titulo="Ticket promedio" valor={formatearDinero(hoy.ticketPromedio)} />
        <Tile titulo="Margen" valor={formatearDinero(hoy.margen)} detalle={hoy.base > 0 ? `${hoy.margenPorcentaje} % sobre la venta sin IVA` : 'Sin ventas'} />
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Ventas de los últimos 7 días</h3>
        <GraficaBarras datos={ultimos7} etiqueta={etiquetaDia} />
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Alertas</h3>
        {activas.length === 0 && <p className="text-sm text-slate-500">Sin alertas. Todo en orden.</p>}
        <ul className="divide-y divide-slate-100">
          {activas.map(([clave, texto, Icono, ruta]) => (
            <li key={clave}>
              <Link to={ruta} className="flex items-center gap-3 py-2 hover:bg-slate-50 rounded">
                <Icono size={18} className="text-amber-600" aria-hidden="true" />
                <span className="flex-1 text-sm text-slate-800">{texto}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{alertas[clave]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
