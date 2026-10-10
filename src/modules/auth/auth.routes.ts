import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { validate } from '../../middleware/validateRequest';
import * as controller from './auth.controller';
import { loginSchema, registerSchema } from './auth.validation';

const router = Router();

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);
router.post('/logout', controller.logout);
router.get('/me', authRequired, controller.me);

export default router;
