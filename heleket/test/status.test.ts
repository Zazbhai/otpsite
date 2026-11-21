import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AmlLinkStatus,
  PaymentStatus,
  PayoutStatus,
  isAmlLinkStatusFinal,
  isAmlLinkStatusSuccessful,
  isPaymentStatusFinal,
  isPaymentStatusSuccessful,
  isPayoutStatusFinal,
  isPayoutStatusSuccessful,
  toAmlLinkStatus,
} from '../src/status.js';

describe('PaymentStatus', () => {
  it('classifies final vs intermediate', () => {
    assert.equal(isPaymentStatusFinal(PaymentStatus.Paid), true);
    assert.equal(isPaymentStatusFinal(PaymentStatus.PaidOver), true);
    assert.equal(isPaymentStatusFinal(PaymentStatus.WrongAmount), true);
    assert.equal(isPaymentStatusFinal(PaymentStatus.Check), false);
    assert.equal(isPaymentStatusFinal(PaymentStatus.ConfirmCheck), false);
    assert.equal(isPaymentStatusFinal(PaymentStatus.WrongAmountWaiting), false);
  });

  it('classifies successful payments', () => {
    assert.equal(isPaymentStatusSuccessful(PaymentStatus.Paid), true);
    assert.equal(isPaymentStatusSuccessful(PaymentStatus.PaidOver), true);
    assert.equal(isPaymentStatusSuccessful(PaymentStatus.WrongAmount), false);
    assert.equal(isPaymentStatusSuccessful(PaymentStatus.Fail), false);
  });
});

describe('PayoutStatus', () => {
  it('classifies final vs intermediate', () => {
    assert.equal(isPayoutStatusFinal(PayoutStatus.Paid), true);
    assert.equal(isPayoutStatusFinal(PayoutStatus.Fail), true);
    assert.equal(isPayoutStatusFinal(PayoutStatus.Process), false);
    assert.equal(isPayoutStatusFinal(PayoutStatus.Check), false);
  });

  it('classifies successful payouts', () => {
    assert.equal(isPayoutStatusSuccessful(PayoutStatus.Paid), true);
    assert.equal(isPayoutStatusSuccessful(PayoutStatus.Fail), false);
  });
});

describe('AmlLinkStatus', () => {
  it('classifies final vs intermediate', () => {
    assert.equal(isAmlLinkStatusFinal(AmlLinkStatus.Completed), true);
    assert.equal(isAmlLinkStatusFinal(AmlLinkStatus.Expired), true);
    assert.equal(isAmlLinkStatusFinal(AmlLinkStatus.Init), false);
    assert.equal(isAmlLinkStatusFinal(AmlLinkStatus.Pending), false);
  });

  it('classifies successful (completed) links', () => {
    assert.equal(isAmlLinkStatusSuccessful(AmlLinkStatus.Completed), true);
    assert.equal(isAmlLinkStatusSuccessful(AmlLinkStatus.Expired), false);
  });

  it('normalises unknown wire values to Unknown', () => {
    assert.equal(toAmlLinkStatus('pending'), AmlLinkStatus.Pending);
    assert.equal(toAmlLinkStatus('something-new'), AmlLinkStatus.Unknown);
  });
});
