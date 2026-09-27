import { create } from 'zustand'
import type { TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'
import { LINK_MINUTES, addMinutes, durationMinutes } from '@/utils/schedule'

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 登记 / 清除某段的实际出发时刻（空串表示尚未执行） */
  recordActual: (id: string, actualDepartAt: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段 */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<TransitRoute>(db.routes)
    rows.sort((a, b) => a.departAt.localeCompare(b.departAt))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<TransitRoute>(db.routes, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate()
  },
  recordActual: async (id, actualDepartAt) => {
    const row = get().rows.find((item) => item.id === id)
    if (!row) return
    const next: TransitRoute = { ...row, actualDepartAt }
    if (actualDepartAt && row.actualNote === '待执行') next.actualNote = '已出发'
    if (!actualDepartAt && row.actualNote === '已出发') next.actualNote = '待执行'
    await putRow<TransitRoute>(db.routes, next)
    await get().hydrate()
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    const existing = await loadAll<TransitRoute>(db.routes)
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    const points = await loadAll<{ id: string; longitude: number; latitude: number }>(db.dropPoints)
    const lookup = new Map(points.map((item) => [item.id, item]))
    // 首段按选定时刻出发，后段默认按前段计划到达 + 30 分钟装卸衔接
    let cursor = meta.departAt
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      const durationH = estimateDurationH(km)
      const planDepartAt = cursor
      const planArriveAt = addMinutes(planDepartAt, durationMinutes(durationH))
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH,
        vehicleType: meta.vehicleType,
        departAt: planDepartAt,
        planDepartAt,
        planArriveAt,
        actualDepartAt: '',
        riskNote: meta.riskNote,
        actualNote: '待执行'
      })
      cursor = addMinutes(planArriveAt, LINK_MINUTES)
    }
    await get().hydrate()
  }
}))
