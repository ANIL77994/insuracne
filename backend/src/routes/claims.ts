import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { requireFeature, requireClaimAction } from '../middleware/access';
import { asyncHandler, createError } from '../middleware/errorHandler';

const router = Router();

// Get all claims
router.get('/', requireFeature('claims', 'view'), asyncHandler(async (req: any, res: Response) => {
  const { page = 1, limit = 20, status, priority, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let whereClause = 'WHERE workspace_id = $1';
  const queryParams = [req.workspace_id];
  let paramCount = 1;

  if (status) {
    paramCount++;
    whereClause += ` AND status = $${paramCount}`;
    queryParams.push(status);
  }

  if (priority) {
    paramCount++;
    whereClause += ` AND priority = $${paramCount}`;
    queryParams.push(priority);
  }

  if (search) {
    paramCount++;
    whereClause += ` AND (claim_number ILIKE $${paramCount} OR claimant_name ILIKE $${paramCount})`;
    queryParams.push(`%${search}%`);
  }

  const claimsQuery = await db.query(`
    SELECT 
      claim_id, claim_number, claim_type, status, priority,
      claimant_name, incident_date, reported_date, claimed_amount,
      approved_amount, settlement_amount, assigned_adjuster, created_at
    FROM claims 
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, [...queryParams, parseInt(limit), offset]);

  const countQuery = await db.query(
    `SELECT COUNT(*) as total FROM claims ${whereClause}`,
    queryParams
  );

  res.json({
    success: true,
    data: {
      claims: claimsQuery.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countQuery.rows[0].total),
        pages: Math.ceil(parseInt(countQuery.rows[0].total) / parseInt(limit))
      }
    }
  });
}));

// File new claim (FNOL)
router.post('/', requireFeature('claims', 'create'), asyncHandler(async (req: any, res: Response) => {
  const {
    policyId, customerId, claimantName, claimType, incidentDate,
    claimedAmount, claimData
  } = req.body;

  if (!policyId || !claimantName || !claimType || !incidentDate || !claimedAmount) {
    throw createError('Missing required fields', 400, 'VALIDATION_ERROR');
  }

  const claimId = uuidv4();
  const claimNumber = `CLM-${Date.now()}`;

  await db.query(`
    INSERT INTO claims (
      claim_id, workspace_id, claim_number, policy_id, customer_id,
      claimant_name, claim_type, status, priority, incident_date,
      reported_date, claimed_amount, claim_data, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
  `, [
    claimId, req.workspace_id, claimNumber, policyId, customerId,
    claimantName, claimType, 'open', 'normal', incidentDate,
    new Date().toISOString().split('T')[0], claimedAmount, JSON.stringify(claimData || {})
  ]);

  res.status(201).json({
    success: true,
    data: {
      claimId,
      claimNumber,
      message: 'Claim filed successfully'
    }
  });
}));

// Update claim status
router.put(
  '/:claimId/status',
  requireFeature('claims', 'update'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { status, approvedAmount, settlementAmount } = req.body;

    const claim = await prisma.claim.findFirst({
      where: { claimId, workspaceId: req.workspace_id },
      select: { claimId: true, claimType: true, status: true },
    });

    if (!claim) {
      throw createError('Claim not found', 404, 'CLAIM_NOT_FOUND');
    }

    // Guard against status-change privilege bypasses:
    const { canClaimAction } = await import('../services/permissions');
    if (status === 'approved') {
      const allowed = await canClaimAction(req.workspace_id, req.user.role, claim.claimType, 'approve');
      if (!allowed) throw createError('Forbidden: claim action "approve"', 403, 'FORBIDDEN');
    } else if (status === 'rejected') {
      const allowed = await canClaimAction(req.workspace_id, req.user.role, claim.claimType, 'reject');
      if (!allowed) throw createError('Forbidden: claim action "reject"', 403, 'FORBIDDEN');
    } else if (status === 'repudiated') {
      const allowed = await canClaimAction(req.workspace_id, req.user.role, claim.claimType, 'repudiate');
      if (!allowed) throw createError('Forbidden: claim action "repudiate"', 403, 'FORBIDDEN');
    } else if (status === 'settled') {
      const allowed = await canClaimAction(req.workspace_id, req.user.role, claim.claimType, 'payout_processed');
      if (!allowed) throw createError('Forbidden: claim action "payout_processed"', 403, 'FORBIDDEN');
    }

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        status: status || undefined,
        approvedAmount: approvedAmount !== undefined ? approvedAmount : undefined,
        settlementAmount: settlementAmount !== undefined ? settlementAmount : undefined,
      },
    });

    res.json({
      success: true,
      message: 'Claim status updated successfully',
      data: updatedClaim,
    });
  })
);

// Claim action: Approve claim
router.post(
  '/:claimId/approve',
  requireClaimAction('approve', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { approvedAmount } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        status: 'approved',
        approvedAmount: approvedAmount !== undefined ? approvedAmount : undefined,
      },
    });

    res.json({
      success: true,
      message: 'Claim approved successfully',
      data: updatedClaim,
    });
  })
);

// Claim action: Process payout
router.post(
  '/:claimId/payout/process',
  requireClaimAction('payout_processed', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { settlementAmount, paymentReference } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        status: 'settled',
        settlementAmount: settlementAmount !== undefined ? settlementAmount : undefined,
      },
    });

    res.json({
      success: true,
      message: 'Payout processed successfully',
      data: {
        claim: updatedClaim,
        paymentReference,
      },
    });
  })
);

// Assign claim to adjuster
router.put(
  '/:claimId/assign',
  requireClaimAction('assign_adjuster', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { assignedAdjuster } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        assignedAdjuster,
      },
    });

    res.json({
      success: true,
      message: 'Claim assigned successfully',
      data: updatedClaim,
    });
  })
);

// Claim action: Upload invoice
router.post(
  '/:claimId/invoice',
  requireClaimAction('upload_invoice', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { invoiceNumber, amount, vendor } = req.body;

    res.json({
      success: true,
      message: 'Invoice uploaded successfully',
      data: {
        claimId,
        invoiceNumber,
        amount,
        vendor,
      },
    });
  })
);

// Claim action: Repudiate claim
router.post(
  '/:claimId/repudiate',
  requireClaimAction('repudiate', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { reason } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        status: 'repudiated',
      },
    });

    res.json({
      success: true,
      message: 'Claim repudiated successfully',
      data: {
        claim: updatedClaim,
        reason,
      },
    });
  })
);

// Claim action: Reject claim
router.post(
  '/:claimId/reject',
  requireClaimAction('reject', 'claimId'),
  asyncHandler(async (req: any, res: Response) => {
    const { claimId } = req.params;
    const { reason } = req.body;

    const updatedClaim = await prisma.claim.update({
      where: { claimId },
      data: {
        status: 'rejected',
      },
    });

    res.json({
      success: true,
      message: 'Claim rejected successfully',
      data: {
        claim: updatedClaim,
        reason,
      },
    });
  })
);

export default router;