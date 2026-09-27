import dayjs from 'dayjs'
import type { DropPoint, TransitRoute } from '@/types'

/** 相邻两段转场之间的装卸衔接时长（分钟） */
export const TRANSIT_BUFFER_MIN = 30

/** 排程时刻格式（与 datetime-local 一致） */
const TIME_FMT = 'YYYY-MM-DDTHH:mm'

/** 预计耗时（小时）→ 分钟（四舍五入，至少 1 分钟） */
export function durationMinutes(durationH: number): number {
  return Math.max(1, Math.round(durationH * 60))
}

/** 时刻 + 分钟 → 'YYYY-MM-DDTHH:mm' */
export function addMinutes(iso: string, minutes: number): string {
  return dayjs(iso).add(minutes, 'minute').format(TIME_FMT)
}

/** 表格展示用时刻文本 */
export function fmtTime(iso: string): string {
  return iso ? iso.replace('T', ' ') : '—'
}

/** 按段序号排序（seq 缺失的历史数据退化为出发时刻 + id） */
export function sortLegs(routes: TransitRoute[]): TransitRoute[] {
  return [...routes].sort((a, b) => {
    const seqA = a.seq || 0
    const seqB = b.seq || 0
    if (seqA !== seqB) return seqA - seqB
    return a.departAt.localeCompare(b.departAt) || a.id.localeCompare(b.id)
  })
}

/**
 * 全链重算计划时刻：
 * - 已执行段（已登记实际出发）不改计划，以「实际出发 + 预计耗时」作为后续段的衔接基准；
 * - 未执行段：计划出发 = 前段到达 + 30 分钟装卸衔接，计划到达 = 计划出发 + 预计耗时；
 * - 首段未执行时保持其计划出发不变（首段基准由排期时设定）。
 */
export function chainSchedule(routes: TransitRoute[]): TransitRoute[] {
  const ordered = sortLegs(routes)
  let cursorArrive = ''
  return ordered.map((route, index) => {
    if (route.actualDepartAt) {
      cursorArrive = addMinutes(route.actualDepartAt, durationMinutes(route.durationH))
      return route
    }
    const planDepartAt = index === 0 || !cursorArrive ? route.planDepartAt : addMinutes(cursorArrive, TRANSIT_BUFFER_MIN)
    const planArriveAt = addMinutes(planDepartAt, durationMinutes(route.durationH))
    cursorArrive = planArriveAt
    return { ...route, planDepartAt, planArriveAt }
  })
}

/** 路段有效出发时刻（实际优先，否则计划） */
export function effectiveDepart(route: TransitRoute): string {
  return route.actualDepartAt || route.planDepartAt
}

/** 路段有效到达时刻（按有效出发 + 预计耗时推算） */
export function effectiveArrive(route: TransitRoute): string {
  return addMinutes(effectiveDepart(route), durationMinutes(route.durationH))
}

export interface BlockInfo {
  /** 到达投放点撤场时间（原文） */
  withdrawTime: string
  /** 预计到达时刻（顺延后） */
  arriveAt: string
  /** 最早可出发时刻（即顺延后该段的出发时刻） */
  earliestDepart: string
}

/** 受阻判定：有效到达晚于到达投放点撤场日（当日 23:59）即视为受阻 */
export function findBlock(route: TransitRoute, dropPoints: DropPoint[]): BlockInfo | null {
  const target = dropPoints.find((item) => item.id === route.toDropId)
  if (!target || !target.withdrawTime) return null
  const arriveAt = effectiveArrive(route)
  const deadline = dayjs(target.withdrawTime).endOf('day')
  if (!arriveAt || !dayjs(arriveAt).isAfter(deadline)) return null
  return { withdrawTime: target.withdrawTime, arriveAt, earliestDepart: effectiveDepart(route) }
}
