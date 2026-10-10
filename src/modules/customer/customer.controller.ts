import type { Request, Response } from 'express';
import * as service from './customer.service';
import { sendResponse } from '../../utils/sendResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listCustomers(req.query as Record<string, unknown>);
  return sendResponse(res, { message: 'Customers fetched', data });
});

export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getCustomerById(req.params.id);
  return sendResponse(res, { message: 'Customer fetched', data });
});

export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.createCustomer(req.body);
  return sendResponse(res, { statusCode: 201, message: 'Customer created', data });
});

export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.updateCustomer(req.params.id, req.body);
  return sendResponse(res, { message: 'Customer updated', data });
});

export const toggleCustomerActive = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await service.toggleCustomerActive(
      req.params.id,
      req.body.isActive
    );
    return sendResponse(res, { message: 'Customer updated', data });
  }
);

export const addAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.addCustomerAddress(req.params.id, req.body);
  return sendResponse(res, { statusCode: 201, message: 'Address added', data });
});

export const removeAddress = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.removeCustomerAddress(
    req.params.id,
    req.params.addressId
  );
  return sendResponse(res, { message: 'Address removed', data });
});
