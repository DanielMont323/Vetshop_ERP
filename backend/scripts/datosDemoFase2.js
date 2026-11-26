// Datos de DEMOSTRACIÓN de los módulos de la Fase 2 (todo inventado, marcado «(prueba)»), sobre lo que deja
// datosDemo.sembrar: ventas de días anteriores y de hoy, crédito con saldo y un cargo vencido, un abono, cuentas por
// pagar, refrigerador con lecturas (una fuera de rango), metas del mes y una factura de prueba (PAC simulado).
// Se hace con los mismos servicios que usa la app, para que los datos sean consistentes.
const { randomUUID } = require('crypto');
const Usuario = require('../models/Usuario');
const Producto = require('../models/Producto');
const Proveedor = require('../models/Proveedor');
const Cliente = require('../models/Cliente');
const Venta = require('../models/Venta');
const CargoCliente = require('../models/CargoCliente');
const LecturaTemperatura = require('../models/LecturaTemperatura');
const turnos = require('../services/turnos');
const ventas = require('../services/ventas');
const credito = require('../services/credito');
const compras = require('../services/compras');
const cadenaFrio = require('../services/cadenaFrio');
const metas = require('../services/metas');
const facturacion = require('../services/facturacion');
const { diaLocal, finDeDiaTras } = require('../helpers/fechas');

const DIA = 86400000;
const alcanceDe = sucursal => ({ sucursalActiva: sucursal._id, permitidas: 'todas', esDueno: true });

async function sembrarFase2({ centro, norte, almacen, productos }) {
  const dueno = await Usuario.findOne({ usuario: 'dueno.demo' });
  const cajero = await Usuario.findOne({ usuario: 'cajero.centro' });
  const aCentro = alcanceDe(centro);

  // Datos fiscales y claves SAT (RFC de prueba)
  await Cliente.updateOne({ nombre: 'Clínica Patitas (prueba)' }, {
    $set: {
      rfc: 'CPA850101AB1',
      fiscal: { razonSocial: 'CLINICA PATITAS', regimen: '601', codigoPostal: '63000', usoCfdi: 'G03' },
      credito: { activo: true, limite: 500000, dias: 30, bonificacionProntoPago: 200, diasProntoPago: 8 }
    }
  });
  await Cliente.updateOne({ nombre: 'Estética Peludos (prueba)' }, { $set: { credito: { activo: true, limite: 300000, dias: 15, bonificacionProntoPago: 0, diasProntoPago: 8 } } });
  await Producto.updateOne({ _id: productos['CRQ-AD-20']._id }, { $set: { claveSat: '10121800', minimos: [{ sucursal: centro._id, cantidad: 3, maximo: 12 }] } });
  const patitas = await Cliente.findOne({ nombre: 'Clínica Patitas (prueba)' }).lean();
  const peludos = await Cliente.findOne({ nombre: 'Estética Peludos (prueba)' }).lean();

  // Ventas del cajero en Centro (turno abierto): de contado, con tarjeta y a crédito
  await turnos.abrir(aCentro, cajero, { caja: 1, fondo: 50000 });
  const vender = (partidas, pagos, cliente) =>
    ventas.cobrar(aCentro, cajero, { claveOperacion: randomUUID(), cliente, partidas: partidas.map(([sku, cantidad]) => ({ producto: productos[sku]._id, cantidad })), pagos })
      .then(r => r.venta);
  const historicas = [
    await vender([['COLLAR-M', 2]], [{ metodo: 'efectivo', monto: 30000 }]),
    await vender([['CRQ-AD-20', 1]], [{ metodo: 'tarjeta', monto: 129900 }]),
    await vender([['GRA-GATO', 3000]], [{ metodo: 'transferencia', monto: 26970 }]),
    await vender([['COLLAR-M', 1], ['GRA-GATO', 2000]], [{ metodo: 'efectivo', monto: 40000 }])
  ];
  await vender([['COLLAR-M', 1]], [{ metodo: 'efectivo', monto: 20000 }]); // de hoy
  const credPatitas = await vender([['CRQ-AD-20', 2]], [{ metodo: 'credito', monto: 224000 }], patitas._id);
  const credPeludos = await vender([['COLLAR-M', 3]], [{ metodo: 'credito', monto: 44700 }], peludos._id);

  // Fechas en días anteriores (para reportes, metas, compras sugeridas y la factura global)
  for (const [i, v] of historicas.entries()) {
    await Venta.collection.updateOne({ _id: v.id }, { $set: { fecha: new Date(Date.now() - (i + 1) * 2 * DIA) } });
  }
  // El crédito de Estética Peludos venció hace 10 días (para ver la cartera vencida)
  const hace25 = new Date(Date.now() - 25 * DIA);
  await Venta.collection.updateOne({ _id: credPeludos.id }, { $set: { fecha: hace25 } });
  await CargoCliente.collection.updateOne({ venta: credPeludos.id }, { $set: { fecha: hace25, vencimiento: finDeDiaTras(hace25, 15) } });
  // Abono parcial de Clínica Patitas
  await credito.registrarAbono(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, monto: 50000, metodo: 'transferencia', referencia: 'SPEI demo' });

  // Compras al almacén: una a crédito que vence en 5 días y una de contado
  const distribuidora = await Proveedor.findOne({ nombre: 'Distribuidora Veterinaria (prueba)' }).lean();
  const alimentos = await Proveedor.findOne({ nombre: 'Alimentos Mascota (prueba)' }).lean();
  const aAlmacen = alcanceDe(almacen);
  const recibir = async (proveedor, folio, dias, condicionPago, partidas) => {
    const c = await compras.crear(aAlmacen, dueno, { proveedor: proveedor._id, folioFactura: folio, fechaFactura: diaLocal(new Date(Date.now() - dias * DIA)), condicionPago, partidas });
    await compras.confirmar(aAlmacen, dueno, c.id);
  };
  await recibir(distribuidora, 'DEMO-101', 25, 'credito', [{ producto: productos['VAC-RAB']._id, cantidad: 10, costoUnitario: 15500, lote: 'VR-DEMO', caducidad: '06/2028', temperaturaLlegada: 5 }]);
  await recibir(alimentos, 'DEMO-102', 3, 'contado', [{ producto: productos['CRQ-AD-20']._id, cantidad: 10, costoUnitario: 97000, lote: 'CR-DEMO', caducidad: '12/2027' }]);

  // Cadena de frío: refrigerador de Centro con lecturas (una fuera de rango hace 3 días)
  const refri = await cadenaFrio.crearEquipo(aCentro, dueno, { nombre: 'Refri vacunas (prueba)', lecturasPorDia: 2 });
  await cadenaFrio.registrarLectura(aCentro, cajero, { equipo: refri.id, temperatura: 4.5, observacion: 'Apertura' });
  await LecturaTemperatura.create({
    sucursal: centro._id, equipo: refri.id, equipoNombre: refri.nombre, fecha: new Date(Date.now() - 3 * DIA), temperatura: 9.5, rango: { minimo: 2, maximo: 8 },
    fueraDeRango: true, accionCorrectiva: 'Se cerró bien la puerta y se revisó a los 30 minutos', productosAfectados: 'Ninguno', usuario: cajero._id, usuarioNombre: cajero.nombre
  });
  await cadenaFrio.crearEquipo(alcanceDe(norte), dueno, { nombre: 'Refri Norte (prueba)' });

  // Metas del mes
  const periodo = diaLocal().slice(0, 7);
  await metas.fijar(aCentro, dueno, { periodo, monto: 5000000 });
  await metas.fijar(aCentro, dueno, { periodo, vendedor: cajero._id, monto: 3000000 });

  // Factura de prueba de la venta a crédito (solo con el PAC simulado: nunca timbra de verdad desde la demo)
  if ((process.env.FACTURACION_PAC || 'simulado') === 'simulado') {
    await facturacion.facturarCliente(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, ventas: [credPatitas.id] });
  }
}

module.exports = { sembrarFase2 };
