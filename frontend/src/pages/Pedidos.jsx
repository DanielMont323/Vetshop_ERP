import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList, MessageCircle, PackageCheck, Plus, Printer, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { useDialogo } from '../contexts/DialogoContext';
import { mensajeDeError, pedidosAPI, proveedoresAPI } from '../services/api';
import { baseATexto, formatearDinero, formatearFecha } from '../utils/formato';
import { imprimirHtml } from '../utils/caja';
import { enlaceWhatsapp } from '../utils/recordatorios';
import PedidoFormulario from '../components/compras/PedidoFormulario';
import CompraFormulario from '../components/CompraFormulario';

const ESTADOS = {
  borrador: ['Borrador', 'bg-slate-100 text-slate-700'],
  enviado: ['Enviado', 'bg-sky-100 text-sky-800'],
  parcial: ['Recibido parcial', 'bg-amber-100 text-amber-800'],
  recibido: ['Recibido', 'bg-emerald-100 text-emerald-800'],
  cancelado: ['Cancelado', 'bg-red-100 text-red-700']
};
const cantidad = p => `${baseATexto(p.cantidad, p.unidad)} ${p.unidad === 'kg' ? 'kg' : 'pzas'}`;

export function mensajePedido(pedido, proveedor, sucursal) {
  return [
    `Hola ${proveedor?.contacto || pedido.proveedor.nombre}, le enviamos el pedido ${pedido.folio} de Huellitas Vetshop${sucursal ? ` (${sucursal})` : ''}:`,
    '',
    ...pedido.partidas.map(p => `• ${cantidad(p)} ${p.nombre}${p.presentacion ? ` ${p.presentacion}` : ''} (${p.sku})`),
    ...(pedido.notas ? ['', `Notas: ${pedido.notas}`] : []),
    '',
    'Favor de confirmar existencias, precio y fecha de entrega. ¡Gracias!'
  ].join('\n');
}

// Pedidos a proveedores de la sucursal: borrador → enviar (WhatsApp o impreso) → recibir contra el pedido.
export default function Pedidos() {
  const { usuario, sucursalActiva } = useAuth();
  const { confirmar, pedirTexto } = useDialogo();
  const [filtro, setFiltro] = useState('abiertos');
  const [lista, setLista] = useState([]);
  const [proveedores, setProveedores] = useState(new Map());
  const [editando, setEditando] = useState(null); // 'nuevo' | pedido
  const [recibiendo, setRecibiendo] = useState(null); // borrador de compra desde el pedido
  const sucursal = usuario.sucursales.find(s => s.id === sucursalActiva)?.nombre || '';

  const cargar = useCallback(async () => {
    try {
      setLista((await pedidosAPI.listar({ estado: filtro || undefined })).data.datos);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudieron cargar los pedidos'));
    }
  }, [filtro]);
  useEffect(() => {
    cargar();
  }, [cargar, sucursalActiva]);
  useEffect(() => {
    proveedoresAPI.listar({}).then(r => setProveedores(new Map(r.data.datos.map(p => [p.id, p])))).catch(() => {});
  }, []);

  const enviar = async p => {
    const prov = proveedores.get(p.proveedor.id);
    const texto = prov?.whatsapp ? `Se abrirá WhatsApp con el pedido para ${p.proveedor.nombre} y quedará como enviado.` : `${p.proveedor.nombre} no tiene WhatsApp: imprímelo o mándalo por correo. ¿Marcarlo como enviado?`;
    if (!(await confirmar(texto, { textoAceptar: 'Enviar' }))) return;
    try {
      const { data } = await pedidosAPI.enviar(p.id);
      if (prov?.whatsapp) window.open(enlaceWhatsapp(prov.whatsapp, mensajePedido(data.datos, prov, sucursal)), '_blank', 'noopener');
      toast.success(`Pedido ${p.folio} enviado`);
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo enviar'));
    }
  };

  const imprimir = p => pedidosAPI.documento(p.id).then(r => imprimirHtml(r.data)).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')));

  const cancelar = async p => {
    const motivo = await pedirTexto(`¿Por qué se cancela el pedido ${p.folio}?`, { minimo: 3, textoAceptar: 'Cancelar pedido', textoCancelar: 'Volver', peligro: true });
    if (motivo === null) return;
    try {
      await pedidosAPI.cancelar(p.id, motivo);
      cargar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo cancelar'));
    }
  };

  // Recepción contra el pedido: borrador de compra con lo pendiente y el costo estimado
  const recibir = p => setRecibiendo({
    estado: 'borrador', pedido: p.id, proveedor: { id: p.proveedor.id, nombre: p.proveedor.nombre }, folioFactura: '', fechaFactura: new Date().toISOString(),
    condicionPago: (proveedores.get(p.proveedor.id)?.diasCredito || 0) > 0 ? 'credito' : 'contado', diasCredito: proveedores.get(p.proveedor.id)?.diasCredito || 0,
    observaciones: `Contra pedido ${p.folio}`,
    partidas: p.partidas.filter(x => x.pendiente > 0).map(x => ({ producto: x.producto, sku: x.sku, nombre: x.nombre, unidad: x.unidad, tasaIva: x.tasaIva || 0, cantidad: x.pendiente, costoUnitario: x.costoEstimado || 0 }))
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/compras" className="flex items-center gap-1 text-sm text-slate-600"><ArrowLeft size={16} /> Recepción</Link>
        <h2 className="text-lg font-semibold mr-auto flex items-center gap-2"><ClipboardList size={20} aria-hidden="true" /> Pedidos a proveedores</h2>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="group" aria-label="Filtro">
          {[['abiertos', 'Abiertos'], ['recibido', 'Recibidos'], ['cancelado', 'Cancelados'], ['', 'Todos']].map(([v, t]) => (
            <button key={v} type="button" onClick={() => setFiltro(v)} aria-pressed={filtro === v} className={`px-3 py-1.5 ${filtro === v ? 'bg-emerald-600 text-white' : 'bg-white hover:bg-slate-50'}`}>{t}</button>
          ))}
        </div>
        <button type="button" onClick={() => setEditando('nuevo')} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"><Plus size={18} /> Nuevo pedido</button>
      </div>
      <p className="text-sm text-slate-600">También puedes armarlos desde <Link to="/compras-sugeridas" className="text-emerald-700 underline">Compras sugeridas</Link>. Lo que falta por surtir de un pedido enviado cuenta como «en camino».</p>

      <div className="space-y-3">
        {lista.length === 0 && <p className="text-slate-500">No hay pedidos en esta vista.</p>}
        {lista.map(p => (
          <div key={p.id} className="bg-white rounded-xl shadow">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
              <span className="font-semibold">{p.folio}</span>
              <span>{p.proveedor.nombre}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${ESTADOS[p.estado][1]}`}>{ESTADOS[p.estado][0]}</span>
              <span className="text-xs text-slate-500 mr-auto">{formatearFecha(p.enviadoEn || p.creado)}{p.totalEstimado ? ` · estimado ${formatearDinero(p.totalEstimado)}` : ''}</span>
              {p.estado === 'borrador' && <button type="button" onClick={() => setEditando(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Editar</button>}
              {p.estado === 'borrador' && <button type="button" onClick={() => enviar(p)} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700"><MessageCircle size={16} /> Enviar</button>}
              {['enviado', 'parcial'].includes(p.estado) && <button type="button" onClick={() => recibir(p)} className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700"><PackageCheck size={16} /> Recibir mercancía</button>}
              <button type="button" onClick={() => imprimir(p)} aria-label={`Imprimir pedido ${p.folio}`} title="Imprimir / guardar como PDF" className="rounded-lg border border-slate-300 px-2 py-1.5"><Printer size={16} /></button>
              {['borrador', 'enviado', 'parcial'].includes(p.estado) && <button type="button" onClick={() => cancelar(p)} aria-label={`Cancelar pedido ${p.folio}`} className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500"><X size={16} /></button>}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {p.partidas.map(x => (
                  <tr key={String(x.producto)} className="border-t border-slate-50">
                    <td className="px-4 py-1.5">{x.nombre} <span className="text-xs font-mono text-slate-500">{x.sku}</span></td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{cantidad(x)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">{x.recibido ? `recibido ${baseATexto(x.recibido, x.unidad)}` : ''}{x.pendiente && x.recibido ? ` · faltan ${baseATexto(x.pendiente, x.unidad)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {editando && <PedidoFormulario pedido={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); cargar(); }} />}
      {recibiendo && <CompraFormulario compra={recibiendo} alCerrar={() => setRecibiendo(null)} alGuardar={() => { setRecibiendo(null); cargar(); }} />}
    </section>
  );
}
