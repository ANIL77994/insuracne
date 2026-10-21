import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export const errorHandler = (
  error: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Default error response
  let statusCode = 500;
  let errorMessage = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorMessage = 'Validation failed';
    errorCode = 'VALIDATION_ERROR';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorMessage = 'Invalid data format';
    errorCode = 'INVALID_FORMAT';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorMessage = 'Invalid token';
    errorCode = 'INVALID_TOKEN';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    errorMessage = 'Token expired';
    errorCode = 'TOKEN_EXPIRED';
  } else if (error.code === '23505') { // PostgreSQL unique constraint violation
    statusCode = 409;
    errorMessage = 'Resource already exists';
    errorCode = 'DUPLICATE_RESOURCE';
  } else if (error.code === '23503') { // PostgreSQL foreign key constraint violation
    statusCode = 400;
    errorMessage = 'Referenced resource does not exist';
    errorCode = 'INVALID_REFERENCE';
  } else if (error.code === '23502') { // PostgreSQL not null constraint violation
    statusCode = 400;
    errorMessage = 'Required field is missing';
    errorCode = 'MISSING_REQUIRED_FIELD';
  } else if (error.statusCode) {
    statusCode = error.statusCode;
    errorMessage = error.message;
    if (error.code) {
      errorCode = error.code;
    }
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    errorMessage = 'Something went wrong';
  }

  const errorResponse: any = {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      timestamp: new Date().toISOString()
    }
  };

  // Include error details in development or for client errors
  if (process.env.NODE_ENV !== 'production' || statusCode < 500) {
    if (error.details) {
      errorResponse.error.details = error.details;
    }
    
    if (error.stack && process.env.NODE_ENV !== 'production') {
      errorResponse.error.stack = error.stack;
    }
  }

  res.status(statusCode).json(errorResponse);
};

export const createError = (
  message: string,
  statusCode: number = 500,
  code?: string,
  details?: any
): ApiError => {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};