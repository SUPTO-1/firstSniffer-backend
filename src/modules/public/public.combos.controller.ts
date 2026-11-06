import type { Request, Response } from 'express';
import { Combo } from '../combo/combo.model';
import { Product } from '../product/product.model';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicCombo } from '../combo/combo.service';
import { getProductStockForProducts } from '../inventory/inventoryBatch.service';

/**
 * GET /api/public/combos
 *
 * Public storefront combo list — the curated "buy these together" bundles
 * the admin builds in the Combos panel.
 *
 * WHY THIS EXISTS
 *
 * `/api/combos` is admin-only, so combos were invisible AND unbuyable on
 * the storefront: a customer could never see one, and the cart had no way
 * to hold one. The order backend has always supported combo lines — this
 * endpoint is the missing storefront read.
 *
 * SHAPE: a FLAT ARRAY, not a paged envelope.
 *
 * Each combo carries:
 *   - its components, resolved to product name/slug/image so the card can
 *     show what is inside without extra requests
 *   - a per-product stock summary, so an out-of-stock combo is shown as
 *     unavailable rather than being added to the cart and failing at
 *     checkout
 */
export const listPublicCombos = asyncHandler(
  async (_req: Request, res: Response) => {
    const rows = await Combo.find({ isActive: true })
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();

    if (rows.length === 0) {
      return sendResponse(res, { message: 'Combos fetched', data: [] });
    }

    /* Resolve every referenced product in one query. */
    const productIds = [
      ...new Set(
        rows.flatMap((r) =>
          (
            (r as { products?: Array<{ product?: unknown }> }).products ?? []
          ).map((c) => String(c?.product ?? ''))
        )
      ),
    ].filter(Boolean);

    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true,
      deletedAt: null,
    })
      .select('name slug images')
      .lean()
      .exec();

    const productById = new Map(
      products.map((p) => {
        const raw = p as unknown as Record<string, unknown>;
        return [
          String(raw._id ?? ''),
          {
            id: String(raw._id ?? ''),
            name: String(raw.name ?? ''),
            slug: String(raw.slug ?? ''),
            image: String(
              (raw.images as Array<{ url?: string }> | undefined)?.[0]?.url ?? ''
            ),
          },
        ];
      })
    );

    /**
     * Stock for the products these combos consume. A combo is only sellable
     * if EVERY component product has sellable stock.
     */
    const stockByProduct =
      productIds.length > 0
        ? await getProductStockForProducts(productIds)
        : new Map();

    const data = rows
      .map((r) => {
        const raw = r as unknown as Record<string, unknown>;
        const publicCombo = toPublicCombo(raw as never);

        const components = publicCombo.products.map((c) => {
          const product = productById.get(c.product);
          const stock = stockByProduct.get(c.product);
          return {
            product: c.product,
            size: c.size,
            ml: c.ml,
            name: product?.name ?? '',
            slug: product?.slug ?? '',
            image: product?.image ?? '',
            inStock: (stock?.sellableMl ?? 0) > 0,
          };
        });

        /**
         * A component whose product has been deleted or deactivated makes
         * the whole combo unbuyable — we drop the combo rather than sell a
         * bundle that is missing a bottle.
         */
        const missingComponent = components.some((c) => c.name.length === 0);
        const inStock =
          !missingComponent &&
          components.length > 0 &&
          components.every((c) => c.inStock);

        return {
          id: publicCombo.id,
          name: publicCombo.name,
          slug: publicCombo.slug,
          comboPrice: publicCombo.comboPrice,
          image: publicCombo.image,
          products: components,
          inStock,
        };
      })
      .filter((c) => c.products.length > 0);

    return sendResponse(res, { message: 'Combos fetched', data });
  }
);
