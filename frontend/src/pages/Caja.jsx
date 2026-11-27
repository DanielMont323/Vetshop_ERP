import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, PauseCircle, Printer, ReceiptText, UserPlus, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { clientesAPI, configuracionAPI, mensajeDeError, metasAPI, productosAPI, turnosAPI, ventasAPI } from '../services/api';
import { baseATexto, cantidadABase, formatearDinero } from '../utils/formato';
import { descuentoDe, imprimirTicket, importeBruto, nuevaClaveOperacion, porcentajeAPuntosBase, precioPara } from '../utils/caja';
import BuscadorProducto from '../components/BuscadorProducto';
import Carrito from '../components/caja/Carrito';
import PanelCobro from '../components/caja/PanelCobro';
import VentasEspera from '../components/caja/VentasEspera';
import GastoCaja from '../components/caja/GastoCaja';
import ClienteContacto from '../components/clientes/ClienteContacto';
import SelectorReceta from '../components/caja/SelectorReceta';
import { useDialogo } from '../contexts/DialogoContext';

let siguienteClave = 0;
const enfocar = id => setTimeout(() => document.getElementById(id)?.focus(), 0);

// Pantalla de caja: lector de código de barras, F2 buscar, F12 cobrar.
export default function Caja() {
  const { pedirTexto } = useDialogo();
  const { sucursalActiva, usuario, puede } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [creditoPendiente, setCreditoPendiente] = useState(null);
  const [vendedores, setVendedores] = useState([]);
  const [vendedorId, setVendedorId] = useState('');
  const [lineas, setLineas] = useState([]);
  const [esperaId, setEsperaId] = useState(null);
  const [cobrando, setCobrando] = useState(false);
  const [panel, setPanel] = useState(null); // null | 'cobro' | 'espera'
  const [clave, setClave] = useState(nuevaClaveOperacion);
  const [ultima, setUltima] = useState(null);
  const [imprimir, setImprimir] = useState(true);
  const [turno, setTurno] = useState(undefined); // undefined = cargando, null = sin turno
  const [eligiendoReceta, setEligiendoReceta] = useState(null); // clave de la línea que elige receta
  const [motivos, setMotivos] = useState([]);
  const [cotizacion, setCotizacion] = useState({}); // clave de línea → precio que cobrará el servidor
  const [cotizando, setCotizando] = useState(false);

  useEffect(() => {
    configuracionAPI.obtener().then(r => setMotivos(r.data.datos.descuentos?.motivos || [])).catch(() => setMotivos([]));
  }, []);

  useEffect(() => {
    clientesAPI.listar({ activo: true }).then(r => {
      setClientes(r.data.datos);
      setClienteId(id => id || r.data.datos[0]?.id || '');
    }).catch(e => toast.error(mensajeDeError(e, 'No se pudieron cargar los clientes')));
  }, []);

  useEffect(() => {
    turnosAPI.actual().then(r => setTurno(r.data.datos)).catch(() => setTurno(null));
    metasAPI.vendedores().then(r => setVendedores(r.data.datos)).catch(() => setVendedores([]));
    setVendedorId('');
  }, [sucursalActiva]);
  const turnoAbierto = turno?.estado === 'abierto';

  const cliente = clientes.find(c => c.id === clienteId);
  const lista = cliente?.listaPrecios || 'publico';

  // El servidor decide el precio (lista, mayoreo por cantidad o promoción): se le pide una cotización al cambiar el carrito
  const firmaCotizacion = `${lineas.map(l => `${l.clave}:${l.producto.id}:${l.cantidad}`).join('|')}#${clienteId}#${sucursalActiva}`;
  useEffect(() => {
    const validas = lineas
      .map(l => ({ l, cantidad: cantidadABase(l.cantidad, l.producto.unidad) }))
      .filter(x => x.cantidad && !Number.isNaN(x.cantidad));
    if (!validas.length) {
      setCotizacion({});
      setCotizando(false);
      return undefined;
    }
    let vigente = true;
    setCotizando(true);
    const t = setTimeout(() => {
      const esPublico = !clienteId || clientes[0]?.id === clienteId;
      ventasAPI.cotizar({ ...(!esPublico && { cliente: clienteId }), partidas: validas.map(x => ({ producto: x.l.producto.id, cantidad: x.cantidad })) })
        .then(r => vigente && setCotizacion(Object.fromEntries(validas.map((x, i) => [x.l.clave, r.data.datos[i] && { ...r.data.datos[i], cantidad: x.cantidad }]))))
        .catch(() => vigente && setCotizacion({}))
        .finally(() => vigente && setCotizando(false));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaCotizacion]);

  const calculos = useMemo(() => lineas.map(l => {
    const cantidad = cantidadABase(l.cantidad, l.producto.unidad);
    const cot = cotizacion[l.clave];
    const cotizada = Boolean(cot && cot.cantidad === cantidad && cot.producto === l.producto.id);
    const p = cotizada ? { precio: cot.precioUnitario, lista: cot.listaAplicada } : precioPara(l.producto, lista);
    const pb = porcentajeAPuntosBase(l.descuento);
    const motivo = motivos.find(m => m.nombre === l.motivo);
    let error = null;
    if (!p) error = 'Sin precio de venta';
    else if (!cantidad || Number.isNaN(cantidad)) error = l.producto.unidad === 'kg' ? 'Escribe los kg (hasta 3 decimales)' : 'Cantidad inválida';
    else if (Number.isNaN(pb)) error = 'Descuento inválido (0 a 100 %)';
    else if (pb && motivo && pb > motivo.maximo) error = `«${motivo.nombre}» permite hasta ${motivo.maximo / 100} % de descuento`;
    else if (l.producto.requiereReceta && !l.receta) error = 'Requiere receta: elige una receta validada';
    else if (l.receta && cantidad > l.receta.pendiente) error = `La receta R-${l.receta.folio} solo permite surtir ${baseATexto(l.receta.pendiente, l.producto.unidad)}`;
    const bruto = p && cantidad && !Number.isNaN(cantidad) ? importeBruto(p.precio, cantidad, l.producto.unidad) : 0;
    const descuento = Number.isNaN(pb) ? 0 : descuentoDe(bruto, pb);
    return {
      precio: p?.precio ?? null, lista: p?.lista, cantidad, puntosBase: pb, bruto, descuento, importe: bruto - descuento, error,
      origen: cotizada ? cot.origenPrecio : 'lista', precioLista: cotizada ? cot.precioLista : null,
      escalaDesde: cotizada ? cot.escalaDesde : null, promocion: cotizada ? cot.promocion : null,
      pidePin: descuento > 0 && (!motivo || motivo.requierePin)
    };
  }), [lineas, lista, cotizacion, motivos]);

  const lineaReceta = lineas.find(l => l.clave === eligiendoReceta);
  const total = calculos.reduce((s, c) => s + c.importe, 0);
  const descuentoTotal = calculos.reduce((s, c) => s + c.descuento, 0);
  const pidePinDescuento = calculos.some(c => c.pidePin);
  const listo = lineas.length > 0 && calculos.every(c => !c.error) && turnoAbierto && !cotizando;

  const agregar = useCallback(producto => {
    if (!producto.activo) return toast.error(`${producto.nombre} está desactivado`);
    siguienteClave += 1;
    const claveNueva = siguienteClave;
    // Una pieza que ya está en el carrito suma 1; un producto por kg siempre pide el peso
    setLineas(actuales => {
      const i = actuales.findIndex(l => l.producto.id === producto.id);
      if (i >= 0 && producto.unidad === 'pieza') {
        const n = Number(actuales[i].cantidad) || 0;
        return actuales.map((l, j) => (j === i ? { ...l, cantidad: String(n + 1) } : l));
      }
      return [...actuales, { clave: claveNueva, producto, cantidad: producto.unidad === 'kg' ? '' : '1', descuento: '', motivo: '', receta: null }];
    });
    if (producto.unidad === 'kg') enfocar(`cantidad-${claveNueva}`);
    if (producto.requiereReceta) setEligiendoReceta(claveNueva);
  }, []);

  const cambiar = (i, campo, valor) => setLineas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const quitar = i => setLineas(ls => ls.filter((_, j) => j !== i));

  const limpiar = () => {
    setLineas([]);
    setEsperaId(null);
    setClienteId(clientes[0]?.id || '');
    enfocar('buscador-caja');
  };

  const partidasApi = () => lineas.map((l, i) => ({
    producto: l.producto.id,
    cantidad: calculos[i].cantidad,
    ...(calculos[i].puntosBase && { descuentoPorcentaje: calculos[i].puntosBase }),
    ...(calculos[i].puntosBase && l.motivo && { descuentoMotivo: l.motivo }),
    ...(l.receta && { receta: l.receta.id })
  }));

  const cobrar = async (pagos, autorizacion, autorizacionCredito) => {
    setCobrando(true);
    try {
      const esPublico = clientes[0]?.id === clienteId;
      const r = await ventasAPI.cobrar({
        claveOperacion: clave, cliente: esPublico ? undefined : clienteId, partidas: partidasApi(), pagos,
        ...(autorizacion && { autorizacion }), ...(autorizacionCredito && { autorizacionCredito }), ...(esperaId && { esperaId }),
        ...(vendedorId && { vendedor: vendedorId })
      });
      const venta = r.data.datos;
      setUltima(venta);
      setPanel(null);
      setCreditoPendiente(null);
      setClave(nuevaClaveOperacion());
      limpiar();
      toast.success(`Venta ${venta.serie}-${venta.folio} cobrada${venta.cambio ? ` · Cambio ${formatearDinero(venta.cambio)}` : ''}`, { duration: 6000 });
      if (imprimir) imprimirTicket(venta.id).catch(() => toast.error('No se pudo imprimir el ticket'));
    } catch (e) {
      // Crédito por encima del límite o con saldo vencido: el panel pide el PIN del dueño y se reintenta
      if (e.response?.data?.codigo === 'CREDITO_REQUIERE_AUTORIZACION') setCreditoPendiente({ mensaje: e.response.data.mensaje, ...e.response.data.detalles });
      toast.error(mensajeDeError(e, 'No se pudo cobrar'), { duration: 6000 });
    } finally {
      setCobrando(false);
    }
  };

  const guardarEspera = async () => {
    if (!lineas.length) return;
    const nota = await pedirTexto('Nota para identificarla (p. ej. nombre del cliente):', { valorInicial: cliente && clientes[0]?.id !== clienteId ? cliente.nombre : '', minimo: 0, maximo: 120, textoAceptar: 'Poner en espera' });
    if (nota === null) return;
    try {
      await ventasAPI.guardarEspera({ nota: nota.trim() || undefined, cliente: clientes[0]?.id === clienteId ? undefined : clienteId, partidas: partidasApi().filter(p => p.cantidad && !Number.isNaN(p.cantidad)) });
      if (esperaId) await ventasAPI.eliminarEspera(esperaId).catch(() => {});
      toast.success('Venta guardada en espera');
      limpiar();
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo guardar en espera'));
    }
  };

  const recuperar = async espera => {
    try {
      const productos = await Promise.all(espera.partidas.map(p => productosAPI.obtener(p.producto).then(r => r.data.datos)));
      setLineas(espera.partidas.map((p, i) => {
        siguienteClave += 1;
        return { clave: siguienteClave, producto: productos[i], cantidad: baseATexto(p.cantidad, productos[i].unidad), descuento: p.descuentoPorcentaje ? String(p.descuentoPorcentaje / 100) : '', motivo: p.descuentoMotivo || '', receta: null };
      }));
      setClienteId(espera.cliente || clientes[0]?.id || '');
      setEsperaId(espera.id);
      setPanel(null);
    } catch (e) {
      toast.error(mensajeDeError(e, 'No se pudo recuperar'));
    }
  };

  useEffect(() => {
    const teclas = e => {
      if (panel || eligiendoReceta !== null) return;
      if (e.key === 'F2') {
        e.preventDefault();
        enfocar('buscador-caja');
      } else if (e.key === 'F12') {
        e.preventDefault();
        if (listo) setPanel('cobro');
        else if (!turnoAbierto) toast.error('Abre tu turno de caja antes de cobrar');
        else if (lineas.length) toast.error('Revisa las partidas marcadas en rojo');
      }
    };
    window.addEventListener('keydown', teclas);
    return () => window.removeEventListener('keydown', teclas);
  }, [panel, listo, lineas.length, eligiendoReceta, turnoAbierto]);

  return (
    <section className="grid lg:grid-cols-[1fr_20rem] gap-4 min-h-[calc(100vh-7rem)]">
      <div className="bg-white rounded-xl shadow flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-64"><BuscadorProducto alElegir={agregar} idEntrada="buscador-caja" autoFocus placeholder="Escanea o busca (F2)" /></div>
          <label className="flex items-center gap-2 text-sm">
            Cliente
            <select className="rounded-lg border border-slate-300 px-2 py-2" value={clienteId} onChange={e => setClienteId(e.target.value)}>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.listaPrecios !== 'publico' ? ` (${c.listaPrecios})` : ''}</option>)}
            </select>
          </label>
          {puede('clientes:registrar') && (
            <button type="button" onClick={() => setPanel('cliente')} title="Registrar cliente nuevo" aria-label="Registrar cliente nuevo" className="rounded-lg border border-slate-300 p-2 hover:bg-slate-50"><UserPlus size={18} /></button>
          )}
          {vendedores.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Vendedor
              <select className="rounded-lg border border-slate-300 px-2 py-2" value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
                <option value="">Yo ({usuario.nombre})</option>
                {vendedores.filter(v => v.id !== usuario.id).map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <Carrito motivos={motivos} lineas={lineas} calculos={calculos} alCambiar={cambiar} alQuitar={quitar} alElegirReceta={setEligiendoReceta} />
        </div>
      </div>

      <aside className="space-y-4">
        {turno !== undefined && !turnoAbierto && (
          <div className="rounded-xl bg-amber-100 text-amber-900 p-4 text-sm space-y-1">
            <p className="font-semibold">{turno?.estado === 'contado' ? 'Tu turno está en corte' : 'No tienes turno abierto'}</p>
            <p>{turno?.estado === 'contado' ? 'Falta que el dueño autorice la diferencia para cerrarlo.' : 'Abre tu turno con el fondo de caja para poder cobrar.'}</p>
            <Link to="/corte" className="underline font-medium">Ir a Turno y corte</Link>
          </div>
        )}
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          {descuentoTotal > 0 && (
            <>
              <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{formatearDinero(total + descuentoTotal)}</span></div>
              <div className="flex justify-between text-sm text-amber-700"><span>Descuento</span><span className="tabular-nums">−{formatearDinero(descuentoTotal)}</span></div>
            </>
          )}
          <div className="flex justify-between items-baseline"><span className="text-lg">Total</span><span className="text-3xl font-bold tabular-nums">{formatearDinero(total)}</span></div>
          <p className="text-xs text-slate-500">Precios con IVA incluido.{esperaId && ' Venta recuperada de espera.'}</p>
          <button type="button" disabled={!listo || !sucursalActiva} onClick={() => setPanel('cobro')} className="w-full rounded-lg bg-emerald-600 text-white text-lg font-semibold py-3 hover:bg-emerald-700 disabled:opacity-50">Cobrar (F12)</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={imprimir} onChange={e => setImprimir(e.target.checked)} /> Imprimir ticket al cobrar</label>
        </div>

        <div className="bg-white rounded-xl shadow p-4 grid gap-2 text-sm">
          <button type="button" onClick={guardarEspera} disabled={!lineas.length} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"><PauseCircle size={16} /> Poner en espera</button>
          <button type="button" onClick={() => setPanel('espera')} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50"><Clock size={16} /> Ventas en espera</button>
          <button type="button" onClick={limpiar} disabled={!lineas.length} className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50">Vaciar carrito</button>
          <Link to="/ventas" className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50"><ReceiptText size={16} /> Ventas del día</Link>
          <button type="button" onClick={() => setPanel('gasto')} disabled={!turnoAbierto} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"><Wallet size={16} /> Gasto de caja (mandadito…)</button>
        </div>

        {ultima && (
          <div className="bg-emerald-50 rounded-xl p-4 text-sm space-y-1">
            <p className="font-semibold">Última venta: {ultima.serie}-{ultima.folio}</p>
            <p>Total {formatearDinero(ultima.total)}{ultima.cambio > 0 && <> · Cambio <strong>{formatearDinero(ultima.cambio)}</strong></>}</p>
            <button type="button" onClick={() => imprimirTicket(ultima.id).catch(e => toast.error(mensajeDeError(e, 'No se pudo imprimir')))} className="flex items-center gap-1 text-emerald-800 underline"><Printer size={14} /> Reimprimir ticket</button>
          </div>
        )}
      </aside>

      {panel === 'cobro' && (
        <PanelCobro total={total} cliente={cliente} pideAutorizacion={pidePinDescuento} creditoPendiente={creditoPendiente} cobrando={cobrando} alCobrar={cobrar} alCerrar={() => { setPanel(null); setCreditoPendiente(null); enfocar('buscador-caja'); }} />
      )}
      {panel === 'espera' && <VentasEspera alRecuperar={recuperar} alCerrar={() => setPanel(null)} />}
      {panel === 'gasto' && turnoAbierto && <GastoCaja turnoId={turno.id} alCerrar={() => { setPanel(null); enfocar('buscador-caja'); }} />}
      {panel === 'cliente' && (
        <ClienteContacto
          alCerrar={() => setPanel(null)}
          alGuardar={nuevo => {
            setClientes(cs => [...cs, nuevo]);
            setClienteId(nuevo.id);
            setPanel(null);
          }}
        />
      )}
      {lineaReceta && (
        <SelectorReceta
          producto={lineaReceta.producto}
          alCerrar={() => setEligiendoReceta(null)}
          alElegir={receta => {
            setLineas(ls => ls.map(l => (l.clave === eligiendoReceta ? { ...l, receta } : l)));
            setEligiendoReceta(null);
          }}
        />
      )}
    </section>
  );
}
