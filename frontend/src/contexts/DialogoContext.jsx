import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Diálogos propios para confirmar o pedir un texto. Reemplazan window.confirm / window.prompt, que algunos
// navegadores (o ventanas incrustadas) bloquean y responden "Cancelar" sin mostrar nada.
//
//   const { confirmar, pedirTexto } = useDialogo();
//   if (!(await confirmar('¿Continuar?'))) return;
//   const motivo = await pedirTexto('¿Por qué se cancela?', { minimo: 3 });   // null si se cancela
const DialogoContext = createContext(null);

export function DialogoProvider({ children }) {
  const [dialogo, setDialogo] = useState(null);

  const abrir = useCallback(opciones => new Promise(resolve => setDialogo({ ...opciones, resolve })), []);
  const confirmar = useCallback((mensaje, opciones = {}) => abrir({ tipo: 'confirmar', mensaje, ...opciones }), [abrir]);
  const pedirTexto = useCallback((mensaje, opciones = {}) => abrir({ tipo: 'texto', mensaje, ...opciones }), [abrir]);

  const cerrar = valor => {
    dialogo?.resolve(valor);
    setDialogo(null);
  };

  return (
    <DialogoContext.Provider value={{ confirmar, pedirTexto }}>
      {children}
      {dialogo && <Dialogo dialogo={dialogo} alCerrar={cerrar} />}
    </DialogoContext.Provider>
  );
}

function Dialogo({ dialogo, alCerrar }) {
  const esTexto = dialogo.tipo === 'texto';
  const [valor, setValor] = useState(dialogo.valorInicial ?? '');
  const campo = useRef(null);
  const aceptar = useRef(null);
  const minimo = dialogo.minimo ?? 1;
  const invalido = esTexto && valor.trim().length < minimo;

  useEffect(() => {
    (esTexto ? campo : aceptar).current?.focus();
  }, [esTexto]);

  const enviar = e => {
    e.preventDefault();
    if (invalido) return;
    alCerrar(esTexto ? valor.trim() : true);
  };
  const cancelar = () => alCerrar(esTexto ? null : false);

  return (
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="dialogo-mensaje" onKeyDown={e => e.key === 'Escape' && cancelar()}>
      <form onSubmit={enviar} className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <p id="dialogo-mensaje" className="text-slate-800">{dialogo.mensaje}</p>
        {esTexto && (
          <input
            ref={campo}
            type={dialogo.secreto ? 'password' : 'text'}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            value={valor}
            onChange={e => setValor(e.target.value)}
            maxLength={dialogo.maximo ?? 300}
            placeholder={dialogo.placeholder}
            autoComplete="off"
            aria-label={dialogo.mensaje}
          />
        )}
        {esTexto && invalido && valor && minimo > 1 && <p className="text-xs text-slate-500">Mínimo {minimo} caracteres.</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={cancelar} className="rounded-lg border border-slate-300 px-4 py-2">{dialogo.textoCancelar || 'Cancelar'}</button>
          <button
            ref={aceptar}
            type="submit"
            disabled={invalido}
            className={`rounded-lg text-white px-4 py-2 disabled:opacity-50 ${dialogo.peligro ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {dialogo.textoAceptar || 'Aceptar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useDialogo() {
  const ctx = useContext(DialogoContext);
  if (!ctx) throw new Error('useDialogo debe usarse dentro de <DialogoProvider>');
  return ctx;
}
