import Elysia, { t } from 'elysia'
import dayjs from 'dayjs'
import { auth } from '../auth'
import { UnauthorizedError } from '../errors/unauthorized-error'
import { db } from '../../db/connection'
import { orders } from '../../db/schema'
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm'

export const getDailyRevenueInPeriod = new Elysia().use(auth).get(
  '/metrics/daily-revenue-in-period',
  async ({ getCurrentUser, query, set }) => {
    const { restaurantId } = await getCurrentUser()

    if (!restaurantId) throw new UnauthorizedError()

    const { from, to } = query

    const startDate = from ? dayjs(from) : dayjs().subtract(6, 'days')
    const endDateBasedOnFrom = from ? startDate.add(6, 'days') : dayjs()
    const endDate = to ? dayjs(to) : endDateBasedOnFrom

    if (endDate.diff(startDate, 'days') > 7) {
      set.status = 400

      return {
        message: 'You cannot list revenue in a larger period than 7 days',
      }
    }

    const revenuePerDay = await db
      .select({
        date: sql<string>`TO_CHAR(${orders.createdAt}, 'DD/MM')`,
        revenue: sum(orders.totalInCents).mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          gte(
            orders.createdAt,
            startDate
              .startOf('day')
              .add(startDate.utcOffset(), 'minutes')
              .toDate(),
          ),
          lte(
            orders.createdAt,
            endDate.endOf('day').add(startDate.utcOffset(), 'minutes').toDate(),
          ),
        ),
      )
      .groupBy(sql`TO_CHAR(${orders.createdAt}, 'DD/MM')`)

    const orderedRevenuePerDay = revenuePerDay.toSorted((a, b) => {
      const [dayA, monthA] = a.date.split('/').map(Number)
      const [dayB, monthB] = b.date.split('/').map(Number)

      if (monthA === monthB) return dayA - dayB

      const dateA = new Date(2024, monthA - 1)
      const dateB = new Date(2024, monthB - 1)

      return dateA.getTime() - dateB.getTime()
    })

    return orderedRevenuePerDay || []
  },
  {
    query: t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  },
)
