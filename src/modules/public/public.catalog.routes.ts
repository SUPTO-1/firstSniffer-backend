import { Router } from 'express';
import {
  listPublicAtomizers,
  listPublicFacetCounts,
  listPublicGenres,
  listPublicNotes,
  listPublicOccasions,
  listPublicSeasons,
  listPublicTimes,
  listPublicWeathers,
} from './public.catalog.controller';

const router = Router();

// No auth — public storefront.
router.get('/facet-counts', listPublicFacetCounts);
router.get('/genres', listPublicGenres);
router.get('/notes', listPublicNotes);
router.get('/seasons', listPublicSeasons);
router.get('/occasions', listPublicOccasions);
router.get('/weathers', listPublicWeathers);
router.get('/times', listPublicTimes);
router.get('/atomizers', listPublicAtomizers);

export default router;