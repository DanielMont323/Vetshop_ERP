import { Star } from 'lucide-react';
import { formatearDinero } from '../../utils/formato';

// ¿El cliente participa en el programa de lealtad? (solo clientes registrados de público)
export const participaEnLealtad = (cliente, config) => Boolean(config?.activa && cliente && !cliente.esPublicoGeneral && cliente.tipo === 'publico');

// Franja de la caja con los puntos del cliente y su avance en costales premium
export default function LealtadCliente({ cliente, config }) {
  if (!participaEnLealtad(cliente, config)) return null;
  const { puntos, costales } = cliente.lealtad || { puntos: 0, costales: 0 };
  const premios = config.premiosCostal;
  const ciclo = Math.max(...premios.map(p => p.numero));
  const siguiente = premios.find(p => p.numero > costales) || premios[0];
  return (
    <div className="px-3 py-2 border-b border-amber-100 bg-amber-50 text-sm text-amber-900 flex flex-wrap gap-x-4 gap-y-1 items-center">
      <Star size={16} aria-hidden="true" className="text-amber-500" />
      <span><strong>{puntos}</strong> puntos ({formatearDinero(puntos * config.valorPunto)})</span>
      <span>Costales premium: <strong>{costales}</strong> de {ciclo} · el {siguiente.numero}.º lleva {siguiente.porcentaje / 100} %</span>
    </div>
  );
}
