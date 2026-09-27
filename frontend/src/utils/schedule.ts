import dayjs from 'dayjs'
import type { DropPoint, TransitRoute } from '@/types'

/** 相邻路段装卸衔接时长（分钟）：后段默认按前段到达 +30 分钟衔接 */
export const LINK_MINUTES = 30

/** 时刻存储格式（与 DatePicker showTime 对齐） */
export const TIME_FORMAT = 'YYYY-MM-DDTHH:mm'

/** ISO 时刻 + 分钟数 → ISO 时刻 */
export function addMinutes(iso: string, minutes: number): string {
  return dayjs(iso).add(minutes, 'minute').format(TIME_FORMAT)
}

/** 耗时（小时）→ 分钟（四舍五入） */
export function durationMinutes(durationH: number): number {
  return Math.round(durationH * 60)
}

/** 表格展示用短格式 */
export function fmtTime(iso: string): string {
  return iso ? dayjs(iso).format('MM-DD HH:mm') : '—'
}

/**
 * 把路线按「到达点 → 下一段出发点」串成执行顺序；
 * 无法衔接的段（断链 / 多趟车次）按计划出发时刻依次附后。
 */
export function orderLegs(routes: TransitRoute[]): TransitRoute[] {
  const remaining = [...routes].sort((a, b) => a.planDepartAt.localeCompare(b.planDepartAt) || a.departAt.localeCompare(b.departAt))
  const ordered: TransitRoute[] = []
  while (remaining.length > 0) {
    const toIds = new Set(remaining.map((item) => item.toDropId))
    let leg = remaining.find((item) => !toIds.has(item.fromDropId)) ?? remaining[0]
    ordered.push(leg)
    remaining.splice(remaining.indexOf(leg), 1)
    let next = remaining.find((item) => item.fromDropId === leg.toDropId)
    while (next) {
      const current = next
      ordered.push(current)
      remaining.splice(remaining.indexOf(current), 1)
      next = remaining.find((item) => item.fromDropId === current.toDropId)
    }
  }
  return ordered
}

export type LegStatus = '待执行' | '已顺延' | '受阻' | '已执行'

export interface ScheduleLeg {
  route: TransitRoute
  /** 计划出发 / 到达（生成顺序时按衔接规则排定） */
  planDepartAt: string
  planArriveAt: string
  /** 实际出发（空串 = 未执行） */
  actualDepartAt: string
  /** 生效出发：已执行取实际；未执行取 max(计划, 前段到达 + 衔接) */
  effectiveDepartAt: string
  /** 生效到达 */
  effectiveArriveAt: string
  /** 最早可出发时刻（受前段到达 + 装卸衔接约束） */
  earliestDepartAt: string
  /** 到达投放点的撤场时间（空串 = 未登记） */
  withdrawTime: string
  /** 是否被前段实际变动顺延 */
  delayed: boolean
  /** 生效到达晚于撤场时间 → 受阻 */
  blocked: boolean
  status: LegStatus
}

/**
 * 计算执行排程：
 * 1) 未执行路段出发 = max(计划出发, 前段生效到达 + 30 分钟装卸衔接)，只顺延不提前；
 * 2) 已执行路段按实际出发时刻重算到达，并向后传导；
 * 3) 生效到达晚于到达点撤场时间 → 标记受阻，并给出最早可出发时刻。
 */
export function buildSchedule(routes: TransitRoute[], dropPoints: DropPoint[]): ScheduleLeg[] {
  const pointMap = new Map(dropPoints.map((item) => [item.id, item]))
  const legs: ScheduleLeg[] = []
  let prevArrive: string | null = null
  for (const route of orderLegs(routes)) {
    const planDepartAt = route.planDepartAt || route.departAt
    const planArriveAt = route.planArriveAt || addMinutes(planDepartAt, durationMinutes(route.durationH))
    const actualDepartAt = route.actualDepartAt || ''
    const earliestDepartAt = prevArrive ? addMinutes(prevArrive, LINK_MINUTES) : planDepartAt
    const executed = Boolean(actualDepartAt)
    const effectiveDepartAt = executed
      ? actualDepartAt
      : dayjs(planDepartAt).isAfter(dayjs(earliestDepartAt))
        ? planDepartAt
        : earliestDepartAt
    const effectiveArriveAt = addMinutes(effectiveDepartAt, durationMinutes(route.durationH))
    const withdrawTime = pointMap.get(route.toDropId)?.withdrawTime ?? ''
    const blocked = Boolean(withdrawTime) && dayjs(effectiveArriveAt).isAfter(dayjs(withdrawTime).endOf('day'))
    const delayed = !executed && dayjs(effectiveDepartAt).isAfter(dayjs(planDepartAt))
    const status: LegStatus = executed ? '已执行' : blocked ? '受阻' : delayed ? '已顺延' : '待执行'
    legs.push({
      route,
      planDepartAt,
      planArriveAt,
      actualDepartAt,
      effectiveDepartAt,
      effectiveArriveAt,
      earliestDepartAt,
      withdrawTime,
      delayed,
      blocked,
      status
    })
    prevArrive = effectiveArriveAt
  }
  return legs
}
