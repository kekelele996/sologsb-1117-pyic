import { create } from 'zustand'
import type { TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'
import { TRANSIT_BUFFER_MIN, addMinutes, chainSchedule, durationMinutes, sortLegs } from '@/utils/schedule'

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段（含链式执行排程） */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
  /** 登记 / 清除某段实际出发时刻，并顺延尚未执行的后续路段（空串表示清除） */
  setActualDepart: (id: string, actualDepartAt: string) => Promise<void>
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<TransitRoute>(db.routes)
    set({ rows: sortLegs(rows), loaded: true })
  },
  save: async (row) => {
    await putRow<TransitRoute>(db.routes, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate()
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    const existing = await loadAll<TransitRoute>(db.routes)
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    const points = await loadAll<{ id: string; longitude: number; latitude: number }>(db.dropPoints)
    const lookup = new Map(points.map((item) => [item.id, item]))
    let cursorArrive = ''
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      const durationH = estimateDurationH(km)
      // 首段按设定时刻出发，后段 = 前段计划到达 + 30 分钟装卸衔接
      const planDepartAt = i === 1 ? meta.departAt : addMinutes(cursorArrive, TRANSIT_BUFFER_MIN)
      const planArriveAt = addMinutes(planDepartAt, durationMinutes(durationH))
      cursorArrive = planArriveAt
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH,
        vehicleType: meta.vehicleType,
        departAt: meta.departAt,
        seq: i,
        planDepartAt,
        planArriveAt,
        actualDepartAt: '',
        riskNote: meta.riskNote,
        actualNote: '待执行'
      })
    }
    await get().hydrate()
  },
  setActualDepart: async (id, actualDepartAt) => {
    const all = await loadAll<TransitRoute>(db.routes)
    const target = all.find((row) => row.id === id)
    if (!target) return
    target.actualDepartAt = actualDepartAt
    // 实际出发变动后，全链重算：已执行段不动，未执行段按前段到达 + 30 分钟顺延
    const rescheduled = chainSchedule(all)
    await Promise.all(rescheduled.map((row) => putRow<TransitRoute>(db.routes, row)))
    await get().hydrate()
  }
}))
