// Datos de DEMOSTRACIÓN de todos los módulos (todo inventado, marcado «(prueba)»), sobre lo que deja
// datosDemo.sembrar. Se hace con los mismos servicios que usa la app para que todo sea consistente:
//   - 4 semanas de ventas en Centro y Norte (turnos ya cerrados) y ventas de hoy con un turno abierto en Centro
//   - crédito: saldo con abono y un cargo vencido; cuentas por pagar (una por vencer, una vencida con pago parcial)
//   - traspasos (uno recibido y uno en tránsito), recetas (validada y pendiente), venta en espera
//   - conteo físico aplicado en Norte, refrigeradores con lecturas (una fuera de rango), metas del mes
//   - facturas de prueba con el PAC simulado (a cliente PPD y global de ayer)
const { randomUUID } = require('crypto');
const Usuario = require('../models/Usuario');
const Producto = require('../models/Producto');
const Proveedor = require('../models/Proveedor');
const Cliente = require('../models/Cliente');
const Venta = require('../models/Venta');
const Turno = require('../models/Turno');
const CargoCliente = require('../models/CargoCliente');
const ConteoFisico = require('../models/ConteoFisico');
const LecturaTemperatura = require('../models/LecturaTemperatura');
const ListaPrecios = require('../models/ListaPrecios');
const inv = require('../services/inventario');
const turnos = require('../services/turnos');
const ventas = require('../services/ventas');
const credito = require('../services/credito');
const compras = require('../services/compras');
const cuentasPorPagar = require('../services/cuentasPorPagar');
const traspasos = require('../services/traspasos');
const recetas = require('../services/recetas');
const conteos = require('../services/conteos');
const cadenaFrio = require('../services/cadenaFrio');
const metas = require('../services/metas');
const facturacion = require('../services/facturacion');
const { conTransaccion } = require('../helpers/transaccion');
const { importePartida } = require('../helpers/dinero');
const { diaLocal, finDeDiaTras, deHoraLocal } = require('../helpers/fechas');

const DIA = 86400000;
const DIAS_HISTORIA = 28;
const alcanceDe = sucursal => ({ sucursalActiva: sucursal._id, permitidas: 'todas', esDueno: true });
const hace = (dias, hora = 12) => {
  const [a, m, d] = diaLocal(new Date(Date.now() - dias * DIA)).split('-').map(Number);
  return deHoraLocal(a, m, d, hora, 15);
};

async function sembrarFase2({ centro, norte, almacen, productos, pinDueno, pinMedico }) {
  const dueno = await Usuario.findOne({ usuario: 'dueno.demo' });
  const cajero = await Usuario.findOne({ usuario: 'cajero.centro' });
  const cajeroNorte = await Usuario.findOne({ usuario: 'cajero.norte' });
  const almacenista = await Usuario.findOne({ usuario: 'almacen.demo' });
  const medico = await Usuario.findOne({ usuario: 'medico.demo' });
  const [aCentro, aNorte, aAlmacen] = [centro, norte, almacen].map(alcanceDe);
  const precio = (await ListaPrecios.findOne({ clave: 'publico' }).lean()).precios.reduce((m, p) => ({ ...m, [String(p.producto)]: p.precio }), {});
  const importe = (sku, cantidad) => importePartida({ precioUnitario: precio[String(productos[sku]._id)], cantidad, unidad: productos[sku].unidad });

  // ---- Clientes: datos fiscales y crédito ----
  await Cliente.updateOne({ nombre: 'Clínica Patitas (prueba)' }, {
    $set: {
      rfc: 'CPA850101AB1', fiscal: { razonSocial: 'CLINICA PATITAS', regimen: '601', codigoPostal: '63000', usoCfdi: 'G03' },
      credito: { activo: true, limite: 500000, dias: 30, bonificacionProntoPago: 200, diasProntoPago: 8 }
    }
  });
  await Cliente.updateOne({ nombre: 'Estética Peludos (prueba)' }, { $set: { credito: { activo: true, limite: 300000, dias: 15, bonificacionProntoPago: 0, diasProntoPago: 8 } } });
  await Cliente.create({
    nombre: 'Veterinaria San Roque (prueba)', tipo: 'veterinaria', listaPrecios: 'clinica', rfc: 'VSR900101AB1', email: 'facturas@ejemplo.com',
    fiscal: { razonSocial: 'VETERINARIA SAN ROQUE', regimen: '601', codigoPostal: '63100', usoCfdi: 'G01' }
  });
  await Producto.updateOne({ _id: productos['CRQ-AD-20']._id }, { $set: { minimos: [{ sucursal: centro._id, cantidad: 3, maximo: 12 }, { sucursal: norte._id, cantidad: 2, maximo: 6 }] } });
  await Producto.updateOne({ _id: productos['COLLAR-M']._id }, { $set: { minimos: [{ sucursal: centro._id, cantidad: 10, maximo: 40 }, { sucursal: norte._id, cantidad: 8, maximo: 20 }] } });
  const patitas = await Cliente.findOne({ nombre: 'Clínica Patitas (prueba)' }).lean();
  const peludos = await Cliente.findOne({ nombre: 'Estética Peludos (prueba)' }).lean();

  // ---- Más existencia para la historia de ventas ----
  await conTransaccion(async session => {
    for (const [sucursal, entradas] of [
      [centro, [['COLLAR-M', 80, 7000], ['CRQ-AD-20', 20, 97000, 'CR-2612', '09/2027'], ['GRA-GATO', 60000, 5100, 'GG-3', '08/2027']]],
      [norte, [['COLLAR-M', 40, 7000], ['CRQ-AD-20', 8, 97000, 'CR-2612', '09/2027'], ['GRA-GATO', 40000, 5100, 'GG-3', '08/2027']]]
    ]) {
      for (const [sku, cantidad, costoUnitario, lote, caducidad] of entradas) {
        await inv.registrarEntrada({ sucursal: sucursal._id, producto: productos[sku]._id, cantidad, costoUnitario, lote, caducidad, origen: 'inventario_inicial', usuario: dueno._id }, session);
      }
    }
  });

  // ---- 4 semanas de ventas (en turnos que se dejan cerrados) ----
  const formas = ['efectivo', 'tarjeta', 'transferencia'];
  const vender = async (alcance, actor, partidas, metodo, extra = {}) => {
    const total = partidas.reduce((s, [sku, c]) => s + importe(sku, c), 0);
    const pagos = metodo === 'efectivo' ? [{ metodo, monto: Math.ceil(total / 5000) * 5000 }] : [{ metodo, monto: total }];
    const r = await ventas.cobrar(alcance, actor, { claveOperacion: randomUUID(), partidas: partidas.map(([sku, cantidad]) => ({ producto: productos[sku]._id, cantidad })), pagos, ...extra });
    return r.venta;
  };
  async function historia(sucursal, alcance, actor, porDia) {
    const turno = await turnos.abrir(alcance, actor, { caja: 1, fondo: 50000 });
    for (let d = DIAS_HISTORIA; d >= 1; d -= 1) {
      for (const [i, partidas] of porDia(d).entries()) {
        const v = await vender(alcance, actor, partidas, formas[(d + i) % 3]);
        await Venta.collection.updateOne({ _id: v.id }, { $set: { fecha: hace(d, 10 + i * 3 + (d % 3)) } });
      }
    }
    // Se cierra como si se hubiera hecho el corte sin diferencias
    const t = await Turno.findById(turno.id).setOptions({ sinAlcance: true }).lean();
    const { esperado, ventas: n, canceladas } = await turnos.esperadoDe(t);
    await Turno.collection.updateOne({ _id: t._id }, {
      $set: {
        estado: 'cerrado', vigente: false, 'apertura.fecha': hace(DIAS_HISTORIA, 9), cierre: { fecha: hace(1, 21) },
        conteo: { fecha: hace(1, 21), denominaciones: [], contado: esperado, esperado, diferencias: { efectivo: 0, tarjeta: 0, transferencia: 0 }, ventas: n, canceladas, abonos: 0 }
      }
    });
  }
  await historia(centro, aCentro, cajero, d => [
    [['COLLAR-M', (d % 3) + 1]],
    ...(d % 2 === 0 ? [[['GRA-GATO', 1000 + (d % 4) * 500]]] : []),
    ...(d % 5 === 0 ? [[['CRQ-AD-20', 1], ['COLLAR-M', 1]]] : [])
  ]);
  await historia(norte, aNorte, cajeroNorte, d => (d % 2 === 0 ? [[['COLLAR-M', 1], ['GRA-GATO', 1500]]] : d % 7 === 0 ? [[['CRQ-AD-20', 1]]] : []));

  // ---- Hoy en Centro: turno abierto, ventas de contado y a crédito ----
  await turnos.abrir(aCentro, cajero, { caja: 1, fondo: 50000 });
  await vender(aCentro, cajero, [['COLLAR-M', 2]], 'efectivo');
  await vender(aCentro, cajero, [['CRQ-AD-20', 1]], 'tarjeta');
  const credPatitas = (await ventas.cobrar(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, partidas: [{ producto: productos['CRQ-AD-20']._id, cantidad: 2 }], pagos: [{ metodo: 'credito', monto: 224000 }] })).venta;
  const credPeludos = (await ventas.cobrar(aCentro, cajero, { claveOperacion: randomUUID(), cliente: peludos._id, partidas: [{ producto: productos['COLLAR-M']._id, cantidad: 3 }], pagos: [{ metodo: 'credito', monto: 44700 }] })).venta;
  // El crédito de Estética Peludos venció hace 10 días
  const hace25 = hace(25, 11);
  await Venta.collection.updateOne({ _id: credPeludos.id }, { $set: { fecha: hace25 } });
  await CargoCliente.collection.updateOne({ venta: credPeludos.id }, { $set: { fecha: hace25, vencimiento: finDeDiaTras(hace25, 15) } });
  await credito.registrarAbono(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, monto: 50000, metodo: 'transferencia', referencia: 'SPEI demo' });
  await ventas.guardarEspera(aCentro, cajero, { nota: 'Señora del collar rojo (prueba)', partidas: [{ producto: productos['COLLAR-M']._id, cantidad: 1 }, { producto: productos['GRA-GATO']._id, cantidad: 2000 }] });

  // ---- Compras y cuentas por pagar (Almacén) ----
  const distribuidora = await Proveedor.findOne({ nombre: 'Distribuidora Veterinaria (prueba)' }).lean();
  const alimentos = await Proveedor.findOne({ nombre: 'Alimentos Mascota (prueba)' }).lean();
  const recibir = async (proveedor, folio, dias, condicionPago, partidas, diasCredito) => {
    const c = await compras.crear(aAlmacen, almacenista, { proveedor: proveedor._id, folioFactura: folio, fechaFactura: diaLocal(new Date(Date.now() - dias * DIA)), condicionPago, ...(diasCredito !== undefined && { diasCredito }), partidas });
    return compras.confirmar(aAlmacen, almacenista, c.id);
  };
  await recibir(distribuidora, 'DEMO-101', 25, 'credito', [{ producto: productos['VAC-RAB']._id, cantidad: 10, costoUnitario: 15500, lote: 'VR-DEMO', caducidad: '06/2028', temperaturaLlegada: 5 }]);
  await recibir(alimentos, 'DEMO-102', 3, 'contado', [{ producto: productos['CRQ-AD-20']._id, cantidad: 10, costoUnitario: 97000, lote: 'CR-DEMO', caducidad: '12/2027' }]);
  await recibir(alimentos, 'DEMO-090', 40, 'credito', [{ producto: productos['GRA-GATO']._id, cantidad: 50000, costoUnitario: 5000, lote: 'GG-DEMO', caducidad: '10/2027' }], 15);
  await cuentasPorPagar.registrarPago(dueno, { claveOperacion: randomUUID(), proveedor: alimentos._id, monto: 100000, metodo: 'transferencia', referencia: 'SPEI demo' });

  // ---- Traspasos: uno recibido en Centro y uno en tránsito a Norte ----
  const t1 = await traspasos.enviar(aAlmacen, almacenista, { destino: centro._id, partidas: [{ producto: productos['VAC-RAB']._id, cantidad: 5 }], observaciones: 'Resurtido de vacunas (prueba)' });
  await traspasos.recibir(aCentro, almacenista, t1.id, { recibidos: t1.partidas.map(p => p.lotes.map(l => l.enviado)) });
  await traspasos.enviar(aAlmacen, almacenista, { destino: norte._id, partidas: [{ producto: productos['CRQ-AD-20']._id, cantidad: 3 }, { producto: productos['ANTB-100']._id, cantidad: 4 }] });

  // ---- Recetas en Centro: una validada (lista para surtir) y una pendiente para el médico ----
  const receta = datos => recetas.crear(aCentro, medico, {
    fechaReceta: diaLocal(), medico: { nombre: 'MVZ Laura Ruiz (prueba)', cedula: '1234567' },
    propietario: { nombre: datos.propietario }, paciente: { nombre: datos.paciente, especie: 'Perro' },
    partidas: [{ producto: productos['ANTB-100']._id, cantidadPrescrita: 1, indicaciones: '5 ml cada 12 h por 7 días' }]
  });
  const validada = await receta({ propietario: 'Juan Pérez (prueba)', paciente: 'Firulais' });
  await recetas.validar(aCentro, medico, validada.id, { usuario: 'medico.demo', pin: pinMedico });
  await receta({ propietario: 'María López (prueba)', paciente: 'Luna' });

  // ---- Conteo físico aplicado en Norte hace 5 días (un collar de menos) ----
  const c = await conteos.iniciar(aNorte, almacenista, { nota: 'Conteo semanal (prueba)' });
  for (const [i, r] of (await ConteoFisico.findById(c.id).setOptions({ sinAlcance: true }).lean()).renglones.entries()) {
    await conteos.capturar(aNorte, almacenista, c.id, { renglon: r._id, cantidad: i === 0 ? Math.max(0, r.esperado - 1) : r.esperado });
  }
  await conteos.aRevision(aNorte, almacenista, c.id);
  await conteos.aplicar(aNorte, dueno, c.id, { autorizacion: { usuario: 'dueno.demo', pin: pinDueno } });
  await ConteoFisico.collection.updateOne({ _id: c.id }, { $set: { 'inicio.fecha': hace(5, 8), 'aplicacion.fecha': hace(5, 10) } });

  // ---- Cadena de frío ----
  const lecturasPasadas = async (equipo, sucursal, fuera) => {
    for (let d = 6; d >= 1; d -= 1) {
      for (const [hora, t] of [[9, 4 + (d % 3) * 0.5], [19, 5 + (d % 2) * 0.5]]) {
        const esFuera = fuera && d === 3 && hora === 19;
        await LecturaTemperatura.create({
          sucursal: sucursal._id, equipo: equipo.id, equipoNombre: equipo.nombre, fecha: hace(d, hora), temperatura: esFuera ? 9.5 : t, rango: { minimo: 2, maximo: 8 },
          fueraDeRango: esFuera, observacion: hora === 9 ? 'Apertura' : 'Cierre',
          ...(esFuera && { accionCorrectiva: 'Se cerró bien la puerta y se revisó a los 30 minutos', productosAfectados: 'Ninguno' }),
          usuario: cajero._id, usuarioNombre: cajero.nombre
        });
      }
    }
  };
  const refriCentro = await cadenaFrio.crearEquipo(aCentro, dueno, { nombre: 'Refri vacunas (prueba)' });
  await lecturasPasadas(refriCentro, centro, true);
  await cadenaFrio.registrarLectura(aCentro, cajero, { equipo: refriCentro.id, temperatura: 4.5, observacion: 'Apertura' });
  const refriAlmacen = await cadenaFrio.crearEquipo(aAlmacen, dueno, { nombre: 'Cámara fría almacén (prueba)', lecturasPorDia: 3 });
  await lecturasPasadas(refriAlmacen, almacen, false);
  await cadenaFrio.crearEquipo(aNorte, dueno, { nombre: 'Refri Norte (prueba)' });

  // ---- Metas del mes ----
  const periodo = diaLocal().slice(0, 7);
  await metas.fijar(aCentro, dueno, { periodo, monto: 2500000 });
  await metas.fijar(aCentro, dueno, { periodo, vendedor: cajero._id, monto: 2000000 });
  await metas.fijar(aNorte, dueno, { periodo, monto: 1000000 });

  // ---- Facturas de prueba (solo con el PAC simulado: la demo nunca timbra de verdad) ----
  if ((process.env.FACTURACION_PAC || 'simulado') === 'simulado') {
    await facturacion.facturarCliente(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, ventas: [credPatitas.id] });
    const ayer = diaLocal(new Date(Date.now() - DIA));
    if (ayer.slice(0, 7) === diaLocal().slice(0, 7)) {
      await facturacion.facturarGlobal(aCentro, dueno, { claveOperacion: randomUUID(), periodicidad: 'dia', desde: ayer, hasta: ayer }).catch(() => {});
    }
  }
}

module.exports = { sembrarFase2 };
