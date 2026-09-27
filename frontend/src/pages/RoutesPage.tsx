import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { DropPoint, TransitRoute } from '@/types'
import { VEHICLE_TYPES } from '@/types'
import RouteMap from '@/components/common/RouteMap'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { distanceKm, estimateDurationH, routeLegs } from '@/utils/geo'
import { LINK_MINUTES, TIME_FORMAT, buildSchedule, fmtTime, type LegStatus, type ScheduleLeg } from '@/utils/schedule'

const STATUS_COLORS: Record<LegStatus, string> = {
  待执行: 'default',
  已顺延: 'orange',
  受阻: 'red',
  已执行: 'green'
}

/** 转场路线规划：地图上依次选点生成顺序与里程，支持拖动调整顺序并重算 */
export default function RoutesPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)

  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [vehicleType, setVehicleType] = useState<TransitRoute['vehicleType']>('厢式货车')
  const [departAt, setDepartAt] = useState(dayjs())
  const [riskNote, setRiskNote] = useState('')

  const ordered = useMemo(
    () => orderedIds.map((id) => dropPoints.find((item) => item.id === id)).filter((item): item is DropPoint => Boolean(item)),
    [orderedIds, dropPoints]
  )

  const legs = useMemo(() => routeLegs(ordered.map((item) => ({ longitude: item.longitude, latitude: item.latitude }))), [ordered])

  /** 执行排程：计划出发 / 到达 + 实际出发变动后的顺延与受阻判定 */
  const schedule = useMemo(() => buildSchedule(routes, dropPoints), [routes, dropPoints])
  const blockedCount = useMemo(() => schedule.filter((leg) => leg.blocked).length, [schedule])

  function orchardName(orchardId: string): string {
    return orchards.find((item) => item.id === orchardId)?.name ?? '未知地块'
  }

  function addPoint(id: string): void {
    if (orderedIds.includes(id)) {
      message.info('该投放点已在顺序中')
      return
    }
    setOrderedIds((prev) => [...prev, id])
  }

  function removePoint(id: string): void {
    setOrderedIds((prev) => prev.filter((item) => item !== id))
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= orderedIds.length) return
    const next = [...orderedIds]
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    setOrderedIds(next)
  }

  function handleDrop(targetId: string): void {
    if (!draggingId || draggingId === targetId) return
    setOrderedIds((prev) => {
      const next = prev.filter((item) => item !== draggingId)
      const index = next.indexOf(targetId)
      next.splice(index < 0 ? next.length : index, 0, draggingId)
      return next
    })
    setDraggingId(null)
  }

  async function generate(): Promise<void> {
    if (orderedIds.length < 2) {
      message.warning('至少选择 2 个投放点才能生成转场路线')
      return
    }
    await routeStore.getState().rebuildFromOrder(orderedIds, {
      vehicleType,
      departAt: departAt.format('YYYY-MM-DDTHH:mm'),
      riskNote: riskNote.trim()
    })
    message.success(`已生成 ${orderedIds.length - 1} 段转场路线，累计 ${legs.total} km`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">转场路线规划</h2>
          <p className="page-sub">
            在投放点列表中依次选点生成转场顺序与里程；可拖动条目或上下移动调整顺序，里程与耗时实时重算，确认后写回路线表。
            下方执行排程按「前段到达 + {LINK_MINUTES} 分钟装卸」衔接各段，登记实际出发后自动顺延未执行路段，晚于撤场时间的受阻路段会标红。
          </p>
        </div>
        <Space>
          <Button onClick={() => setOrderedIds([])}>清空顺序</Button>
          <Button type="primary" onClick={() => void generate()}>
            生成并保存路线
          </Button>
        </Space>
      </div>

      <Row gutter={16}>
        <Col xs={24} xl={15}>
          <Card size="small" title="地图（投放点与转场折线）">
            <RouteMap
              orchards={orchards}
              dropPoints={dropPoints}
              routes={routes}
              orderedDropIds={orderedIds}
              height={420}
              title="转场顺序预览"
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title="投放点（点击加入转场顺序）" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {dropPoints.map((point) => (
                <Space key={point.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>
                    <Tag color="blue">{point.code}</Tag>
                    {orchardName(point.orchardId)} · 可容纳 {point.capacityBoxes} 箱 · 水源 {point.waterDistance} m
                  </span>
                  <Button size="small" onClick={() => addPoint(point.id)}>
                    加入顺序
                  </Button>
                </Space>
              ))}
              {dropPoints.length === 0 ? <Empty description="暂无投放点，请先在果园地块管理中添加" /> : null}
            </Space>
          </Card>

          <Card size="small" title={`转场顺序（${ordered.length} 点 · 累计 ${legs.total} km）`}>
            {ordered.length === 0 ? (
              <Typography.Text type="secondary">尚未选择投放点</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {ordered.map((point, index) => (
                  <div
                    key={point.id}
                    draggable
                    onDragStart={() => setDraggingId(point.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(point.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px dashed #cfd9e2',
                      borderRadius: 8,
                      background: draggingId === point.id ? '#fff7e6' : '#fff',
                      cursor: 'grab'
                    }}
                  >
                    <Tag color="gold">第 {index + 1} 站</Tag>
                    <span style={{ flex: 1 }}>
                      {point.code} · {orchardName(point.orchardId)}
                      {index > 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          上一段 {distanceKm(ordered[index - 1], point)} km / 约 {estimateDurationH(distanceKm(ordered[index - 1], point))} h
                        </Typography.Text>
                      ) : null}
                    </span>
                    <Button size="small" disabled={index === 0} onClick={() => move(index, -1)}>
                      上移
                    </Button>
                    <Button size="small" disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>
                      下移
                    </Button>
                    <Button size="small" danger type="link" onClick={() => removePoint(point.id)}>
                      移除
                    </Button>
                  </div>
                ))}
              </Space>
            )}
            <Form layout="vertical" style={{ marginTop: 12 }}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="车辆类型" style={{ marginBottom: 8 }}>
                    <Select value={vehicleType} onChange={(value) => setVehicleType(value)} options={VEHICLE_TYPES.map((item) => ({ value: item, label: item }))} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="首段出发时刻" style={{ marginBottom: 8 }}>
                    <DatePicker showTime value={departAt} onChange={(value) => setDepartAt(value ?? dayjs())} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="途中风险备注" style={{ marginBottom: 0 }}>
                    <Input value={riskNote} onChange={(event) => setRiskNote(event.target.value)} placeholder="如 西沟坡道窄，雨天泥泞" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`转场执行排程（${schedule.length} 段 · 合计 ${Math.round(routes.reduce((sum, item) => sum + item.distanceKm, 0) * 100) / 100} km）`}
        extra={
          blockedCount > 0 ? (
            <Tag color="red">{blockedCount} 段受阻：到达将晚于投放点撤场时间</Tag>
          ) : (
            <Tag color="green">各段均可按衔接时刻到达</Tag>
          )
        }
      >
        <Table<ScheduleLeg>
          dataSource={schedule}
          rowKey={(record) => record.route.id}
          pagination={false}
          columns={[
            {
              title: '路段',
              key: 'leg',
              render: (_, record: ScheduleLeg) => {
                const from = dropPoints.find((item) => item.id === record.route.fromDropId)
                const to = dropPoints.find((item) => item.id === record.route.toDropId)
                const label = (point: DropPoint | undefined): string => (point ? `${point.code}（${orchardName(point.orchardId)}）` : '—')
                return (
                  <span>
                    {label(from)} → {label(to)}
                  </span>
                )
              }
            },
            { title: '里程（km）', key: 'km', width: 100, render: (_, record: ScheduleLeg) => record.route.distanceKm },
            { title: '预计耗时（h）', key: 'hour', width: 110, render: (_, record: ScheduleLeg) => record.route.durationH },
            { title: '车辆', key: 'vehicle', width: 100, render: (_, record: ScheduleLeg) => record.route.vehicleType },
            {
              title: '计划出发',
              key: 'planDepart',
              width: 110,
              render: (_, record: ScheduleLeg) => fmtTime(record.planDepartAt)
            },
            {
              title: '计划到达',
              key: 'planArrive',
              width: 110,
              render: (_, record: ScheduleLeg) => fmtTime(record.planArriveAt)
            },
            {
              title: '实际出发',
              key: 'actualDepart',
              width: 190,
              render: (_, record: ScheduleLeg) => (
                <DatePicker
                  showTime
                  allowClear
                  size="small"
                  placeholder="登记实际出发"
                  value={record.actualDepartAt ? dayjs(record.actualDepartAt) : null}
                  onChange={(value) =>
                    void routeStore.getState().recordActual(record.route.id, value ? value.format(TIME_FORMAT) : '')
                  }
                />
              )
            },
            {
              title: '状态 / 衔接提示',
              key: 'status',
              width: 220,
              render: (_, record: ScheduleLeg) => (
                <Space direction="vertical" size={2}>
                  <Tag color={STATUS_COLORS[record.status]}>{record.status}</Tag>
                  {record.delayed ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      顺延至 {fmtTime(record.effectiveDepartAt)} 出发
                    </Typography.Text>
                  ) : null}
                  {record.blocked ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      最早可出发 {fmtTime(record.earliestDepartAt)}，到达 {fmtTime(record.effectiveArriveAt)} 已晚于撤场{' '}
                      {record.withdrawTime}
                    </Typography.Text>
                  ) : null}
                </Space>
              )
            },
            {
              title: '风险备注',
              key: 'risk',
              render: (_, record: ScheduleLeg) => record.route.riskNote || '—'
            },
            {
              title: '操作',
              key: 'action',
              width: 80,
              render: (_, record: ScheduleLeg) => (
                <Button size="small" danger type="link" onClick={() => void routeStore.getState().remove(record.route.id)}>
                  删除
                </Button>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}
