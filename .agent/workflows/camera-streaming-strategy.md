# Estrategia de Estabilidad, Escala y Monetización - CCTGATE Cameras
**Fecha:** 2026-05-04  
**Estado:** En Ejecución (Fase A en progreso)

---

## ¿Por qué se caen las cámaras?
- Node-Media-Server consume ~150MB RAM por cámara activa.
- El VPS de Vultr tiene 1GB RAM total (Ubuntu usa ~200-300MB base).
- Cuando hay 2-3 sesiones activas, Linux mata el proceso (OOM Killer).
- PM2 no estaba configurado para auto-recuperar el proceso.

---

## Fase 1: Estabilizar con PM2 (✅ Completada)
- Configurar PM2 con límite de RAM (`--max-memory-restart 400M`)
- Agregar cron restart a las 04:00 AM (`--cron "0 4 * * *"`)
- Agregar cron job de Linux como respaldo si PM2 falla

## Fase 2: Blindaje del código server.js (✅ Completada)
- Agregar `process.on('uncaughtException')` para capturar errores sin matar el proceso
- Reducir logs excesivos para evitar saturación de disco/CPU

## Fase A: Migración a MediaMTX (🔄 En Progreso)
MediaMTX (antes rtsp-simple-server) reemplaza Node-Media-Server:
| Métrica | Node-Media-Server | MediaMTX |
|---|---|---|
| RAM por cámara | ~150MB | ~8MB |
| Cámaras en VPS $6 | 2-3 | 20-30 |
| Estabilidad | Media | Alta |
| Costo | $0 | $0 |

### Pasos de migración a MediaMTX:
```bash
# 1. En el VPS Vultr, detener Node-Media-Server
pm2 stop nms

# 2. Descargar MediaMTX (última versión)
cd /root
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_v1.9.1_linux_amd64.tar.gz
tar -xzf mediamtx_v1.9.1_linux_amd64.tar.gz

# 3. Configurar mediamtx.yml (ver config abajo)
nano mediamtx.yml

# 4. Levantar con PM2
pm2 start mediamtx --name "mediamtx" -- mediamtx.yml
pm2 save
pm2 startup
```

### Configuración mediamtx.yml:
```yaml
# Puerto RTMP (donde las cámaras Dahua envían el stream)
rtmp:
  address: :1935

# Puerto HLS (lo que usa la app web para ver el video)
hls:
  address: :8888
  
# Rutas de cámaras
paths:
  cam1:
    runOnDemand: ""
  cam2:
    runOnDemand: ""
```

### Cambios en la app (DoorControl.jsx):
- Puerto HLS: cambiar de `8443` a `8888`  
- URL HLS: `https://cctgate.i2r.cl:8888/cam1/index.m3u8`
- El FLV (flv.js) puede mantenerse o migrarse a HLS nativo

---

## Fase B: Escala Media (10-50 clientes) - PENDIENTE
- VPS 2GB Vultr → $12/mes → 40 cámaras
- Cloudflare Stream como CDN → $1 por cada 1000 min → casi $0 para el volumen actual

## Fase C: Escala Real P2P WebRTC - PENDIENTE
- Pion WebRTC (Go) + WHIP/WHEP
- VPS solo coordina (señalización ~5MB/sesión)
- Video fluye cámara → usuario directamente
- Costo fijo aunque sean 500 clientes

---

## Modelo de Monetización
| Plan | Precio | Incluye |
|---|---|---|
| Básico | $9.990 CLP/mes | 1 puerta + historial |
| Pro | $14.990 CLP/mes | 1 puerta + 1 cámara + historial |
| Family | $24.990 CLP/mes | 3 puertas + 3 cámaras |
| Empresa | $49.990 CLP/mes | Ilimitado + multisitio |

Con 15 clientes Pro → $224.850 CLP/mes → cubre infraestructura con margen.

## Road Map
- HOY: Fases 1+2 + Migración MediaMTX
- MES 1-2: MediaMTX estable en Vultr
- MES 3-6: Lanzar Plan Pro con cobro
- MES 6-12: P2P WebRTC + 50 clientes reales
