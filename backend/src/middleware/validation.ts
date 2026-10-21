import { Request, Response, NextFunction } from 'express';

export const validateRequest = (schema?: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schema && schema.validate) {
      const { error } = schema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details ? error.details[0].message : error.message
        });
      }
    }
    next();
  };
};
