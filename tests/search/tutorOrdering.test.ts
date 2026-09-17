import request from 'supertest';
import { app } from '../helpers/app';
import { Tutor } from '../../src/models/Tutor';
import { searchTutorsForAI } from '../../src/services/searchService';
import { ADULT_DOB, createUser } from '../helpers/factories';

type Tier = 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';

interface TutorSpec {
  tier?: Tier;
  /** Raw average; only meaningful alongside a non-zero reviewCount. */
  rating?: number;
  reviewCount?: number;
  baseHourlyRate?: number;
  photo?: boolean;
  bio?: string;
  area?: string;
  qualifications?: string[];
}

/** Everything a tutor can fill in beyond the signup basics. */
const COMPLETE: TutorSpec = {
  photo: true,
  bio: 'Ten years teaching Leaving Cert maths.',
  area: 'Dublin',
  qualifications: ['BSc Mathematics'],
};

/** Whitespace-only text and empty arrays must count as missing, not filled in. */
const BARE: TutorSpec = { photo: false, bio: '   ', area: '', qualifications: [] };

// Weighted rating = (reviews * rating + 5 * 3.5) / (reviews + 5). Handy values:
//   no reviews        -> 3.50 (the prior)
//   5.0 from 1 review -> 3.75
//   4.9 from 10       -> 4.43
//   3.0 from 1 review -> 3.42

async function makeTutor(spec: TutorSpec): Promise<Tutor> {
  const user = await createUser('TUTOR', { dateOfBirth: ADULT_DOB });
  if (spec.photo) await user.update({ profilePhotoUrl: `profile-photos/${user.id}.jpg` });
  return Tutor.create({
    userId: user.id,
    headline: `${user.firstName} ${user.lastName} - Tutor`,
    subjects: ['MATHS'],
    levels: ['LC'],
    baseHourlyRate: spec.baseHourlyRate ?? 40,
    rating: spec.rating ?? 0,
    reviewCount: spec.reviewCount ?? 0,
    featuredTier: spec.tier ?? 'FREE',
    bio: spec.bio,
    area: spec.area,
    qualifications: spec.qualifications ?? [],
  });
}

async function searchIds(query: Record<string, string> = {}): Promise<string[]> {
  const res = await request(app).get('/api/tutors').query(query);
  expect(res.status).toBe(200);
  return res.body.data.items.map((t: { id: string }) => t.id);
}

describe('tutor search ordering', () => {
  test('featured (default): paid tier, then weighted rating, then completeness', async () => {
    const freeBareLower = await makeTutor({ ...BARE, rating: 4.0, reviewCount: 2 });
    const freeCompleteFewerReviews = await makeTutor({ ...COMPLETE, rating: 5.0, reviewCount: 2 });
    const proBare = await makeTutor({ ...BARE, tier: 'PROFESSIONAL', rating: 1.0, reviewCount: 1 });
    const freeCompleteLower = await makeTutor({ ...COMPLETE, rating: 4.0, reviewCount: 2 });
    const freeBareTopRated = await makeTutor({ ...BARE, rating: 5.0, reviewCount: 3 });
    const enterpriseBare = await makeTutor({ ...BARE, tier: 'ENTERPRISE', rating: 0.5, reviewCount: 1 });

    const expected = [
      enterpriseBare.id, // tier beats everything
      proBare.id,
      freeBareTopRated.id, // 5.0 from 3 reviews (4.06) beats 5.0 from 2 (3.93), even though bare
      freeCompleteFewerReviews.id,
      freeCompleteLower.id, // same rating and reviews: complete beats bare
      freeBareLower.id,
    ];
    expect(await searchIds()).toEqual(expected);
    expect(await searchIds({ sortBy: 'featured' })).toEqual(expected);
  });

  test('a 4.9 from ten reviews outranks a 5.0 from one review', async () => {
    const oneReview = await makeTutor({ ...COMPLETE, rating: 5.0, reviewCount: 1 });
    const tenReviews = await makeTutor({ ...BARE, rating: 4.9, reviewCount: 10 });

    expect(await searchIds()).toEqual([tenReviews.id, oneReview.id]);
  });

  test('a single review moves a tutor above or below the unreviewed pack', async () => {
    const onePoorReview = await makeTutor({ ...COMPLETE, rating: 3.0, reviewCount: 1 });
    const unreviewed = await makeTutor({ ...COMPLETE });
    const oneGreatReview = await makeTutor({ ...BARE, rating: 5.0, reviewCount: 1 });

    expect(await searchIds()).toEqual([oneGreatReview.id, unreviewed.id, onePoorReview.id]);
  });

  test('a bare higher-rated profile beats a complete lower-rated one at equal review counts', async () => {
    const complete = await makeTutor({ ...COMPLETE, rating: 4.5, reviewCount: 10 });
    const bare = await makeTutor({ ...BARE, rating: 4.6, reviewCount: 10 });

    expect(await searchIds()).toEqual([bare.id, complete.id]);
  });

  test('among unreviewed tutors, more filled-in profiles rank higher', async () => {
    const nothing = await makeTutor({ ...BARE });
    const photoOnly = await makeTutor({ ...BARE, photo: true });
    const photoAndBio = await makeTutor({ ...BARE, photo: true, bio: 'Patient and thorough.' });

    expect(await searchIds()).toEqual([photoAndBio.id, photoOnly.id, nothing.id]);
  });

  test('rating sort: weighted rating, then completeness, ignoring tier', async () => {
    const bareNew = await makeTutor({ ...BARE });
    const completeNew = await makeTutor({ ...COMPLETE });
    const bareManyReviews = await makeTutor({ ...BARE, rating: 5.0, reviewCount: 5 }); // 4.25
    const proLow = await makeTutor({ ...BARE, tier: 'PROFESSIONAL', rating: 3.0, reviewCount: 2 }); // 3.36

    expect(await searchIds({ sortBy: 'rating' })).toEqual([
      bareManyReviews.id,
      completeNew.id,
      bareNew.id,
      proLow.id,
    ]);
  });

  test('price sorts: price, then weighted rating, then completeness', async () => {
    const cheapBare = await makeTutor({ ...BARE, baseHourlyRate: 30 });
    const cheapComplete = await makeTutor({ ...COMPLETE, baseHourlyRate: 30 });
    const cheapBareRated = await makeTutor({ ...BARE, baseHourlyRate: 30, rating: 4.5, reviewCount: 2 }); // 3.79
    const dearComplete = await makeTutor({ ...COMPLETE, baseHourlyRate: 50 });

    expect(await searchIds({ sortBy: 'price_asc' })).toEqual([
      cheapBareRated.id,
      cheapComplete.id,
      cheapBare.id,
      dearComplete.id,
    ]);
    expect(await searchIds({ sortBy: 'price_desc' })).toEqual([
      dearComplete.id,
      cheapBareRated.id,
      cheapComplete.id,
      cheapBare.id,
    ]);
  });

  test('AI assistant search uses the same featured ordering', async () => {
    const freeCompleteLower = await makeTutor({ ...COMPLETE, rating: 4.0, reviewCount: 4 });
    const freeBareTop = await makeTutor({ ...BARE, rating: 5.0, reviewCount: 4 });
    const freeCompleteTop = await makeTutor({ ...COMPLETE, rating: 5.0, reviewCount: 4 });
    const proBare = await makeTutor({ ...BARE, tier: 'PROFESSIONAL', rating: 1.0, reviewCount: 1 });

    const results = await searchTutorsForAI({});
    expect(results.map((r) => r.id)).toEqual([proBare.id, freeCompleteTop.id, freeBareTop.id, freeCompleteLower.id]);
  });
});
