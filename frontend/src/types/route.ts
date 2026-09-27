/** 车辆类型 */
export const VEHICLE_TYPES = ['厢式货车', '农用三轮', '皮卡', '人工搬运'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/** TransitRoute 转场路线 */
export interface TransitRoute {
  id: string
  /** 出发投放点 */
  fromDropId: string
  /** 到达投放点 */
  toDropId: string
  /** 预计里程（km） */
  distanceKm: number
  /** 预计耗时（小时） */
  durationH: number
  vehicleType: VehicleType
  /** 转场日期时刻（首段出发基准，兼容字段） */
  departAt: string
  /** 段序号（转场链内顺序，1 起） */
  seq: number
  /** 计划出发时刻（YYYY-MM-DDTHH:mm） */
  planDepartAt: string
  /** 计划到达时刻（YYYY-MM-DDTHH:mm） */
  planArriveAt: string
  /** 实际出发时刻（空串表示尚未执行） */
  actualDepartAt: string
  /** 途中风险备注 */
  riskNote: string
  /** 实际转场记录 */
  actualNote: string
}
