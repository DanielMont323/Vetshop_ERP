import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authAPI, CLAVE_SUCURSAL, CLAVE_TOKEN } from '../services/api';

const AuthContext = createContext(null);

// Sesión del usuario y sucursal activa. La sucursal activa se manda en X-Sucursal en cada
// petición (api.js); el servidor decide si el usuario puede usarla.
export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(Boolean(localStorage.getItem(CLAVE_TOKEN)));
  const [sucursalActiva, setSucursalActivaState] = useState(localStorage.getItem(CLAVE_SUCURSAL));

  const elegirSucursal = useCallback(id => {
    if (id) localStorage.setItem(CLAVE_SUCURSAL, id);
    else localStorage.removeItem(CLAVE_SUCURSAL);
    setSucursalActivaState(id || null);
  }, []);

  // Si la sucursal guardada ya no es del usuario, toma la primera disponible
  const aplicarPerfil = useCallback(
    perfil => {
      setUsuario(perfil);
      const guardada = localStorage.getItem(CLAVE_SUCURSAL);
      const valida = perfil.sucursales.some(s => s.id === guardada);
      elegirSucursal(valida ? guardada : perfil.sucursales[0]?.id || null);
    },
    [elegirSucursal]
  );

  useEffect(() => {
    if (!localStorage.getItem(CLAVE_TOKEN)) return;
    authAPI
      .perfil()
      .then(res => aplicarPerfil(res.data.datos))
      .catch(() => localStorage.removeItem(CLAVE_TOKEN))
      .finally(() => setCargando(false));
  }, [aplicarPerfil]);

  const iniciarSesion = useCallback(
    async (nombreUsuario, password) => {
      const res = await authAPI.login({ usuario: nombreUsuario, password });
      localStorage.setItem(CLAVE_TOKEN, res.data.datos.token);
      aplicarPerfil(res.data.datos.usuario);
    },
    [aplicarPerfil]
  );

  const cerrarSesion = useCallback(() => {
    localStorage.removeItem(CLAVE_TOKEN);
    setUsuario(null);
  }, []);

  // Tras cambiar la contraseña el servidor devuelve un token nuevo (los anteriores ya no sirven)
  const reemplazarToken = useCallback(token => localStorage.setItem(CLAVE_TOKEN, token), []);

  const puede = useCallback(permiso => Boolean(usuario?.permisos.includes(permiso)), [usuario]);

  const valor = useMemo(
    () => ({ usuario, cargando, sucursalActiva, elegirSucursal, iniciarSesion, cerrarSesion, reemplazarToken, puede }),
    [usuario, cargando, sucursalActiva, elegirSucursal, iniciarSesion, cerrarSesion, reemplazarToken, puede]
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return contexto;
}
