// Datos de DEMOSTRACIÓN de la Fase 3 (todo inventado, marcado «(prueba)»), sobre lo que dejan datosDemo y
// datosDemoFase2. Con los mismos servicios que usa la app:
//   - configuración: «Cliente frecuente» hasta 10 % sin PIN (para enseñarlo); el resto pide PIN
//   - mayoreo por cantidad y costal premium en las croquetas; mayoreo en collares
//   - promociones: accesorios 10 % (vigente), lote de vacunas por caducar (vigente) y una próxima
//   - clientes de público con WhatsApp, mascotas, ventas con lealtad (premio del 5.º costal, puntos y canje),
//     descuento con motivo y gastos de caja en el turno abierto de Centro
//   - recordatorios para avisar hoy, próximos y ya avisados
//   - proveedores con WhatsApp y pedidos en el Almacén: borrador, enviado y recibido parcial
//   - abono de Clínica Patitas con complemento de pago (solo con el PAC simulado)
// Se puede correr sobre una base demo que ya tenga las Fases 1 y 2 (npm run demo-fase3).
const { randomUUID } = require('crypto');
const Usuario = require('../models/Usuario');
const Sucursal = require('../models/Sucursal');
const Producto = require('../models/Producto');
const Proveedor = require('../models/Proveedor');
const Cliente = require('../models/Cliente');
const Turno = require('../models/Turno');
const inv = require('../services/inventario');
const turnos = require('../services/turnos');
const ventas = require('../services/ventas');
const configuracion = require('../services/configuracion');
const promociones = require('../services/promociones');
const mascotas = require('../services/mascotas');
const recordatorios = require('../services/recordatorios');
const pedidos = require('../services/pedidos');
const compras = require('../services/compras');
const credito = require('../services/credito');
const abonosDistribucion = require('../services/abonosDistribucion');
const { conTransaccion } = require('../helpers/transaccion');
const { diaLocal } = require('../helpers/fechas');

const MARCA = 'Accesorios 10 % (prueba)'; // si ya existe esta promoción, la Fase 3 ya se cargó
const alcanceDe = sucursal => ({ sucursalActiva: sucursal._id, permitidas: 'todas', esDueno: true });
const { sumarDias } = recordatorios;

async function yaCargada() {
  return Boolean(await require('../models/Promocion').exists({ nombre: MARCA }));
}

async function sembrarFase3() {
  const [centro, almacen] = await Promise.all([Sucursal.findOne({ nombre: 'Centro (prueba)' }), Sucursal.findOne({ nombre: 'Almacén (prueba)' })]);
  if (!centro || !almacen) throw new Error('Faltan las sucursales de la demo (Centro y Almacén)');
  const [dueno, cajero, almacenista] = await Promise.all(['dueno.demo', 'cajero.centro', 'almacen.demo'].map(usuario => Usuario.findOne({ usuario })));
  const productos = Object.fromEntries((await Producto.find({ sku: { $in: ['CRQ-AD-20', 'GRA-GATO', 'VAC-RAB', 'ANTB-100', 'COLLAR-M'] } })).map(p => [p.sku, p]));
  const [aCentro, aAlmacen] = [centro, almacen].map(alcanceDe);
  const hoy = diaLocal();

  // ---- Configuración ----
  await configuracion.actualizar(dueno, {
    descuentos: {
      motivos: [
        { nombre: 'Cliente frecuente', maximo: 1000, requierePin: false },
        { nombre: 'Recomendación', maximo: 1000, requierePin: true },
        { nombre: 'Empaque dañado', maximo: 1500, requierePin: true },
        { nombre: 'Otro', maximo: 10000, requierePin: true }
      ]
    }
  });

  // ---- Catálogo: mayoreo por cantidad y costal premium ----
  await Producto.updateOne({ _id: productos['CRQ-AD-20']._id }, { $set: { alimentoPremium: true, escalas: [{ desde: 3, precio: 124900 }, { desde: 10, precio: 119900 }] } });
  await Producto.updateOne({ _id: productos['COLLAR-M']._id }, { $set: { escalas: [{ desde: 6, precio: 12900 }] } });
  await conTransaccion(session => inv.registrarEntrada({
    sucursal: centro._id, producto: productos['CRQ-AD-20']._id, cantidad: 20, costoUnitario: 97000, lote: 'CR-2801', caducidad: '01/2028', origen: 'inventario_inicial', usuario: dueno._id
  }, session));

  // ---- Promociones ----
  await promociones.crear({ nombre: MARCA, tipo: 'porcentaje', valor: 1000, alcance: 'categoria', categoria: 'accesorio', desde: hoy, hasta: sumarDias(hoy, 10) }, dueno);
  await promociones.crear({ nombre: 'Vacunas por caducar (prueba)', tipo: 'precio', valor: 19900, alcance: 'lote', producto: productos['VAC-RAB']._id, lote: 'VR-0310', sucursales: [centro._id], desde: hoy, hasta: sumarDias(hoy, 10) }, dueno);
  await promociones.crear({ nombre: 'Navidad croquetas (prueba)', tipo: 'precio', valor: 119900, alcance: 'producto', producto: productos['CRQ-AD-20']._id, desde: sumarDias(hoy, 20), hasta: sumarDias(hoy, 35) }, dueno);

  // ---- Contacto de los clientes de distribución ----
  await Cliente.updateOne({ nombre: 'Clínica Patitas (prueba)' }, { $set: { whatsapp: '3110000101', telefono: '311 000 0101', direccion: 'Av. México 120, Centro, Tepic (prueba)' } });
  await Cliente.updateOne({ nombre: 'Estética Peludos (prueba)' }, { $set: { whatsapp: '3110000102', direccion: 'Calle Lerdo 45, Tepic (prueba)' } });
  await Cliente.updateOne({ nombre: 'Veterinaria San Roque (prueba)' }, { $set: { telefono: '311 000 0103', direccion: 'Blvd. Tepic-Xalisco 300 (prueba)' } });

  // ---- Clientes de público con mascotas ----
  const [ana, carlos, lucia] = await Cliente.create([
    { nombre: 'Ana Martínez (prueba)', tipo: 'publico', listaPrecios: 'publico', whatsapp: '3110000201', direccion: 'Col. San José 12 (prueba)', notas: 'Compra croqueta adulto cada mes' },
    { nombre: 'Carlos Ruiz (prueba)', tipo: 'publico', listaPrecios: 'publico', whatsapp: '3110000202', telefono: '311 000 0202' },
    { nombre: 'Lucía Gómez (prueba)', tipo: 'publico', listaPrecios: 'publico', telefono: '311 000 0203', notas: 'Prefiere llamada' }
  ]);
  const max = await mascotas.crear({ cliente: ana._id, nombre: 'Max', especie: 'perro', raza: 'Labrador', sexo: 'macho', nacimiento: '2021-03-15', peso: 28000 }, cajero);
  const michi = await mascotas.crear({ cliente: ana._id, nombre: 'Michi', especie: 'gato', raza: 'Doméstico', sexo: 'hembra', peso: 4200 }, cajero);
  const rocky = await mascotas.crear({ cliente: carlos._id, nombre: 'Rocky', especie: 'perro', raza: 'Schnauzer', sexo: 'macho', nacimiento: '2020-08-01', peso: 8500 }, cajero);
  const pelusa = await mascotas.crear({ cliente: lucia._id, nombre: 'Pelusa', especie: 'gato', raza: 'Persa', sexo: 'hembra' }, cajero);

  // ---- Ventas de hoy en Centro (turno abierto del cajero) ----
  let turno = await Turno.findOne({ sucursal: centro._id, cajero: cajero._id, estado: 'abierto' }).lean();
  if (!turno) turno = { _id: (await turnos.abrir(aCentro, cajero, { caja: 1, fondo: 50000 })).id };
  const vender = async (cliente, partidas, pagos) => (await ventas.cobrar(aCentro, cajero, {
    claveOperacion: randomUUID(), cliente: cliente?._id, pagos,
    partidas: partidas.map(([sku, cantidad, extra]) => ({ producto: productos[sku]._id, cantidad, ...extra }))
  })).venta;
  const efectivo = monto => [{ metodo: 'efectivo', monto }];
  // Ana: 4 costales (mayoreo desde 3) → puntos; luego el 5.º costal lleva 5 % y paga una parte con puntos
  await vender(ana, [['CRQ-AD-20', 4]], efectivo(500000));
  await vender(ana, [['CRQ-AD-20', 1], ['COLLAR-M', 1]], [{ metodo: 'puntos', monto: 5000 }, { metodo: 'efectivo', monto: 200000 }]);
  // Carlos: costal + collar con 10 % «Cliente frecuente» (sin PIN)
  await vender(carlos, [['CRQ-AD-20', 1], ['COLLAR-M', 1, { descuentoPorcentaje: 1000, descuentoMotivo: 'Cliente frecuente' }]], [{ metodo: 'tarjeta', monto: 129900 + 14900 - 1490 - 1341 }]);
  // Público en general: 6 collares (mayoreo + promoción de accesorios) y una vacuna del lote en promoción
  await vender(null, [['COLLAR-M', 6], ['VAC-RAB', 1]], efectivo(100000));
  // Gastos de caja del turno (sin PIN, debajo del tope)
  // (si el turno ya trae gastos y alguno pasaría del tope sin PIN, ese se omite)
  for (const gasto of [{ concepto: 'Garrafón de agua', monto: 4500 }, { concepto: 'Mandadito', monto: 12000, motivo: 'Bolsas para entregas' }]) {
    await turnos.retirar(aCentro, cajero, turno._id, { tipo: 'gasto', ...gasto }).catch(error => {
      if (error.codigo !== 'AUTORIZACION_REQUERIDA') throw error;
    });
  }

  // ---- Recordatorios ----
  const recordar = datos => recordatorios.crear(aCentro, cajero, datos);
  await recordar({ cliente: ana._id, mascota: max.id, tipo: 'alimento', descripcion: 'Croquetas Perro Adulto 20 kg', producto: productos['CRQ-AD-20']._id, fecha: sumarDias(hoy, 2), repetirCadaDias: 30 });
  await recordar({ cliente: ana._id, mascota: michi.id, tipo: 'vacuna', descripcion: 'Vacuna triple felina', fecha: sumarDias(hoy, 5), repetirCadaDias: 365 });
  await recordar({ cliente: carlos._id, mascota: rocky.id, tipo: 'cita', descripcion: 'Baño y corte en Estética Peludos', fecha: sumarDias(hoy, 5) });
  await recordar({ cliente: lucia._id, mascota: pelusa.id, tipo: 'desparasitante', descripcion: 'Desparasitante interno', fecha: sumarDias(hoy, 20), repetirCadaDias: 90 });
  const avisado = await recordar({ cliente: carlos._id, mascota: rocky.id, tipo: 'alimento', descripcion: 'Croqueta razas pequeñas', fecha: sumarDias(hoy, 1), repetirCadaDias: 30 });
  await recordatorios.marcarAvisado(aCentro, cajero, avisado.id);

  // ---- Proveedores con WhatsApp y pedidos en el Almacén ----
  const distribuidora = await Proveedor.findOneAndUpdate({ nombre: 'Distribuidora Veterinaria (prueba)' }, { $set: { whatsapp: '3110000301' } }, { new: true }).lean();
  const alimentos = await Proveedor.findOneAndUpdate({ nombre: 'Alimentos Mascota (prueba)' }, { $set: { whatsapp: '3110000302', contacto: 'Mostrador' } }, { new: true }).lean();
  await pedidos.crear(aAlmacen, almacenista, {
    proveedor: distribuidora._id, notas: 'Confirmar caducidad mayor a 6 meses',
    partidas: [{ producto: productos['ANTB-100']._id, cantidad: 10, costoEstimado: 20500 }, { producto: productos['VAC-RAB']._id, cantidad: 20, costoEstimado: 15500 }]
  });
  const enviado = await pedidos.crear(aAlmacen, almacenista, { proveedor: alimentos._id, origen: 'sugeridas', partidas: [{ producto: productos['CRQ-AD-20']._id, cantidad: 20, costoEstimado: 97000 }, { producto: productos['GRA-GATO']._id, cantidad: 50000, costoEstimado: 5000 }] });
  await pedidos.enviar(aAlmacen, almacenista, enviado.id);
  const parcial = await pedidos.crear(aAlmacen, almacenista, { proveedor: distribuidora._id, partidas: [{ producto: productos['VAC-RAB']._id, cantidad: 10, costoEstimado: 15500 }] });
  await pedidos.enviar(aAlmacen, almacenista, parcial.id);
  const recepcion = await compras.crear(aAlmacen, almacenista, {
    pedido: parcial.id, proveedor: distribuidora._id, folioFactura: 'DEMO-201', fechaFactura: hoy, condicionPago: 'credito',
    partidas: [{ producto: productos['VAC-RAB']._id, cantidad: 6, costoUnitario: 15500, lote: 'VR-2811', caducidad: '08/2028', temperaturaLlegada: 4 }]
  });
  await compras.confirmar(aAlmacen, almacenista, recepcion.id);

  // ---- Abono de Clínica Patitas con complemento de pago (PAC simulado) ----
  if ((process.env.FACTURACION_PAC || 'simulado') === 'simulado') {
    const patitas = await Cliente.findOne({ nombre: 'Clínica Patitas (prueba)' }).lean();
    const { abono } = await credito.registrarAbono(aCentro, cajero, { claveOperacion: randomUUID(), cliente: patitas._id, monto: 30000, metodo: 'transferencia', referencia: 'SPEI demo 2' });
    await abonosDistribucion.emitirComplementos(cajero, abono.id);
  }
}

module.exports = { sembrarFase3, yaCargada, MARCA };
