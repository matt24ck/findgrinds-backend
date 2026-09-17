import { Op, literal } from 'sequelize';
import type { Order, OrderItem } from 'sequelize';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { Resource } from '../models/Resource';
import { resolveUrl } from './storageService';
import { computeAvailability } from '../routes/availability';

/**
 * Shared tutor/resource search helpers.
 *
 * The `buildTutorWhere` / `buildResourceWhere` builders are the single source of
 * truth for search filters — used by both the public REST routes
 * (`routes/tutors.ts`, `routes/resources.ts`) and the AI assistant
 * (`services/aiService.ts`), so filter behaviour can never drift between them.
 *
 * The `*ForAI` functions return compact, link-enriched projections so the model
 * only ever works with real DB rows (it can never invent a tutor, price, or id).
 */

export interface TutorFilters {
  /** Tutor name (or part of it); every whitespace-separated token must match first or last name. */
  name?: string;
  subject?: string;
  level?: string;
  area?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  minRating?: number | string;
  teachesInIrish?: boolean;
}

export interface ResourceFilters {
  subject?: string;
  level?: string;
  resourceType?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
}

/** Build the Sequelize WHERE clause for a tutor search. Mirrors GET /api/tutors. */
export function buildTutorWhere(filters: TutorFilters): any {
  const { subject, level, area, minPrice, maxPrice, minRating, teachesInIrish } = filters;
  const where: any = { isVisible: true };

  if (subject) where.subjects = { [Op.contains]: [subject] };

  // Level is inclusive: a tutor stored as 'BOTH' teaches Junior AND Leaving Cert, so a
  // JC/LC search must still match them (and vice-versa). 'BOTH' as a search term means
  // "Junior OR Leaving" — match anyone teaching either. Uses array overlap (&&), not contains.
  if (level) {
    const expand: Record<string, string[]> = {
      JC: ['JC', 'BOTH'],
      LC: ['LC', 'BOTH'],
      BOTH: ['JC', 'LC', 'BOTH'],
    };
    where.levels = { [Op.overlap]: expand[level] || [level] };
  }

  if (minPrice || maxPrice) {
    where.baseHourlyRate = {};
    if (minPrice) where.baseHourlyRate[Op.gte] = Number(minPrice);
    if (maxPrice) where.baseHourlyRate[Op.lte] = Number(maxPrice);
  }

  if (minRating) where.rating = { [Op.gte]: Number(minRating) };
  if (area) where.area = area;
  if (teachesInIrish) where.teachesInIrish = true;

  return where;
}

/**
 * Tutor sort orders — shared by GET /api/tutors and the AI assistant so the
 * two can never disagree about who comes first.
 *
 * Precedence (featured): paid tier, then confidence-weighted rating, then
 * profile completeness. Crowd-sourced quality outranks a polished profile, so
 * completeness only separates tutors the crowd rates the same — in practice
 * mostly new tutors with no reviews yet.
 *
 * Profile completeness scores one point for each of: profile photo, bio,
 * headline, area, subjects, levels, qualifications. Whitespace-only text and
 * empty arrays count as missing.
 *
 * The expressions reference the main-table alias ("Tutor") and the joined
 * User alias ("User"), so callers must include the User model without an `as`.
 */
export type TutorSortBy = 'featured' | 'rating' | 'price_asc' | 'price_desc';

/**
 * Confidence-weighted rating (Bayesian average). A tutor's raw average is
 * pulled toward RATING_PRIOR_MEAN until they have collected enough reviews:
 * with RATING_PRIOR_WEIGHT = 5, a single review counts 1/6 and the prior 5/6.
 *
 *   weighted = (reviewCount * rating + WEIGHT * MEAN) / (reviewCount + WEIGHT)
 *
 * So a 4.9 from ten reviews (≈4.43) outranks a 5.0 from one review (≈3.75),
 * and tutors with no reviews yet sit exactly at the prior (3.5).
 */
export const RATING_PRIOR_MEAN = 3.5;
export const RATING_PRIOR_WEIGHT = 5;

export const TUTOR_WEIGHTED_RATING_SQL =
  `((COALESCE("Tutor"."review_count", 0) * COALESCE("Tutor"."rating", 0) + ${RATING_PRIOR_WEIGHT * RATING_PRIOR_MEAN})::numeric` +
  ` / (COALESCE("Tutor"."review_count", 0) + ${RATING_PRIOR_WEIGHT}))`;

const PROFILE_COMPLETENESS_CHECKS: string[] = [
  `"User"."profile_photo_url" IS NOT NULL AND btrim("User"."profile_photo_url") <> ''`,
  `"Tutor"."bio" IS NOT NULL AND btrim("Tutor"."bio") <> ''`,
  `"Tutor"."headline" IS NOT NULL AND btrim("Tutor"."headline") <> ''`,
  `"Tutor"."area" IS NOT NULL AND btrim("Tutor"."area") <> ''`,
  `COALESCE(cardinality("Tutor"."subjects"), 0) > 0`,
  `COALESCE(cardinality("Tutor"."levels"), 0) > 0`,
  `COALESCE(cardinality("Tutor"."qualifications"), 0) > 0`,
];

/** SQL expression scoring how complete a tutor profile is (0..7). */
export const TUTOR_PROFILE_COMPLETENESS_SQL = `(${PROFILE_COMPLETENESS_CHECKS.map(
  (check) => `(CASE WHEN ${check} THEN 1 ELSE 0 END)`
).join(' + ')})`;

/** Build the Sequelize ORDER clause for a tutor search. Mirrors GET /api/tutors. */
export function buildTutorOrder(sortBy: string | undefined): Order {
  // Crowd-sourced quality first; completeness only breaks ties within it.
  const quality: OrderItem[] = [
    [literal(TUTOR_WEIGHTED_RATING_SQL), 'DESC'],
    ['reviewCount', 'DESC'],
    [literal(TUTOR_PROFILE_COMPLETENESS_SQL), 'DESC'],
  ];
  // Deterministic tail so rows that tie on everything else still page consistently.
  const tail: OrderItem[] = [
    ['createdAt', 'ASC'],
    ['id', 'ASC'],
  ];

  switch (sortBy as TutorSortBy) {
    case 'rating':
      return [...quality, ...tail];
    case 'price_asc':
      return [['baseHourlyRate', 'ASC'], ...quality, ...tail];
    case 'price_desc':
      return [['baseHourlyRate', 'DESC'], ...quality, ...tail];
    case 'featured':
    default:
      // Paid tier always wins; then weighted rating; then completeness.
      return [['featuredTier', 'DESC'], ...quality, ...tail];
  }
}

/** Build the Sequelize WHERE clause for a resource search. Mirrors GET /api/resources. */
export function buildResourceWhere(filters: ResourceFilters): any {
  const { subject, level, resourceType, minPrice, maxPrice } = filters;
  const where: any = { status: 'PUBLISHED' };

  if (subject) where.subject = subject;
  if (level) where.level = level;
  if (resourceType) where.resourceType = resourceType;

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) where.price[Op.gte] = Number(minPrice);
    if (maxPrice) where.price[Op.lte] = Number(maxPrice);
  }

  return where;
}

/** Normalize a tutor's levels: expand 'BOTH' → ['JC', 'LC']. */
function normalizeLevels(levels: string[] | undefined): string[] {
  if (!levels) return [];
  if (!levels.includes('BOTH')) return levels;
  return Array.from(new Set(levels.flatMap((l) => (l === 'BOTH' ? ['JC', 'LC'] : [l]))));
}

export interface AITutorResult {
  id: string;
  name: string;
  headline: string;
  subjects: string[];
  levels: string[];
  area: string | null;
  hourlyRate: number;
  rating: number;
  reviewCount: number;
  teachesInIrish: boolean;
  featuredTier: string;
  verified: boolean;
  profilePhotoUrl: string | null;
  profileUrl: string;
  bookUrl: string;
}

/**
 * Search tutors for the AI assistant. Returns a compact, link-enriched
 * projection (max `limit`) — never raw model rows, never invented data.
 */
export async function searchTutorsForAI(
  filters: TutorFilters,
  limit = 6
): Promise<AITutorResult[]> {
  const where = buildTutorWhere(filters);

  // Name lookup lives here (not in buildTutorWhere) because it filters the joined User row.
  // The AI needs it to verify a tutor the user named instead of guessing.
  const nameTokens = String(filters.name || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const userInclude: any = {
    model: User,
    attributes: ['firstName', 'lastName', 'profilePhotoUrl', 'gardaVettingVerified'],
  };
  if (nameTokens.length) {
    userInclude.required = true;
    userInclude.where = {
      [Op.and]: nameTokens.map((tok) => ({
        [Op.or]: [{ firstName: { [Op.iLike]: `%${tok}%` } }, { lastName: { [Op.iLike]: `%${tok}%` } }],
      })),
    };
  }

  const tutors = await Tutor.findAll({
    where,
    order: buildTutorOrder('featured'),
    limit,
    include: [userInclude],
  });

  return Promise.all(
    tutors.map(async (t) => {
      const data: any = t.toJSON();
      const user = data.User || data.user || {};
      return {
        id: data.id,
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Tutor',
        headline: data.headline || '',
        subjects: data.subjects || [],
        levels: normalizeLevels(data.levels),
        area: data.area ?? null,
        hourlyRate: Number(data.baseHourlyRate),
        rating: Number(data.rating) || 0,
        reviewCount: data.reviewCount || 0,
        teachesInIrish: !!data.teachesInIrish,
        featuredTier: data.featuredTier || 'FREE',
        verified: !!user.gardaVettingVerified,
        profilePhotoUrl: user.profilePhotoUrl ? await resolveUrl(user.profilePhotoUrl) : null,
        profileUrl: `/tutors/${data.id}`,
        bookUrl: `/book/${data.id}`,
      };
    })
  );
}

export interface AIResourceResult {
  id: string;
  title: string;
  description: string;
  subject: string;
  level: string;
  resourceType: string;
  price: number;
  rating: number;
  salesCount: number;
  tutorName: string | null;
  url: string;
}

/** Search resources for the AI assistant. Returns a compact projection. */
export async function searchResourcesForAI(
  filters: ResourceFilters,
  limit = 6
): Promise<AIResourceResult[]> {
  const where = buildResourceWhere(filters);

  const resources = await Resource.findAll({
    where,
    order: [['salesCount', 'DESC']],
    limit,
    include: [
      {
        model: Tutor,
        as: 'tutor',
        attributes: ['id'],
        include: [{ model: User, attributes: ['firstName', 'lastName'] }],
      },
    ],
  });

  return resources.map((r) => {
    const data: any = r.toJSON();
    const tutorUser = data.tutor?.User || data.tutor?.user;
    const desc: string = data.description || '';
    return {
      id: data.id,
      title: data.title,
      description: desc.length > 240 ? `${desc.slice(0, 240)}…` : desc,
      subject: data.subject,
      level: data.level,
      resourceType: data.resourceType,
      price: Number(data.price),
      rating: Number(data.rating) || 0,
      salesCount: data.salesCount || 0,
      tutorName: tutorUser ? `${tutorUser.firstName} ${tutorUser.lastName}`.trim() : null,
      url: `/resources/${data.id}`,
    };
  });
}

export interface AIAvailabilitySlot {
  date: string;
  startTime: string;
  endTime: string;
  price: number;
}

/**
 * Return the next few open 1:1 (VIDEO) slots for a tutor over the next 14 days,
 * so the assistant can speak to real availability and the card can show it.
 */
export async function getTutorAvailabilityForAI(
  tutorId: string,
  limit = 5
): Promise<AIAvailabilitySlot[]> {
  const tutor = await Tutor.findByPk(tutorId);
  if (!tutor) return [];

  const start = new Date().toISOString().split('T')[0];
  const endD = new Date();
  endD.setDate(endD.getDate() + 14);
  const end = endD.toISOString().split('T')[0];

  const { slots } = await computeAvailability(tutorId, start, end, 'VIDEO' as any);

  return slots
    .filter((s: any) => s.available)
    .slice(0, limit)
    .map((s: any) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      price: Number(s.price),
    }));
}
