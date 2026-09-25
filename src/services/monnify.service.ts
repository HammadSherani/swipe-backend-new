import axios, { AxiosError } from 'axios';
import { env } from '../config/env.js';
import { BadRequestError } from '../errors/custom-errors.js';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const MONNIFY_BASE_URL = env.MONNIFY_BASE_URL;
const MONNIFY_API_KEY = env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = env.MONNIFY_CONTRACT_CODE;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface OnboardMerchantInput {
  merchantId: string;      // Internal DB primary uuid — used as accountReference
  businessName: string;
  ownerName: string;
  email: string;
  mobile: string;
  bvn: string;
  accountNumber: string;   // NUBAN to validate before reserving accounts
  bankCode: string;
}

interface MonnifyLoginResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    accessToken: string;
    expiresIn: number;
  };
}

interface MonnifyAccountValidationResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    accountNumber: string;
    accountName: string;
    bankCode: string;
  };
}

export interface MonnifyReservedAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
}

interface MonnifyReservedAccountResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    contractCode: string;
    accountReference: string;
    accountName: string;
    currencyCode: string;
    customerEmail: string;
    accounts: MonnifyReservedAccount[];
    status: string;
  };
}

interface MonnifyBalanceResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    availableBalance: number;
    ledgerBalance: number;
  };
}

interface MonnifyBanksResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: Array<{ name: string; code: string }>;
}

export type MonnifyMatchStatus = 'FULL_MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH';

interface MonnifyBvnAccountMatchResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    bvn: string;
    accountNumber: string;
    bankCode: string;
    matchStatus: MonnifyMatchStatus;
  };
}

// ─────────────────────────────────────────────
// SERVICE CLASS
// ─────────────────────────────────────────────
export class MonnifyService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0; // epoch ms

  /**
   * Login and cache the bearer token until shortly before it expires.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');

    try {
      const response = await axios.post<MonnifyLoginResponse>(
        `${MONNIFY_BASE_URL}/api/v1/auth/login`,
        {},
        {
          headers: { Authorization: `Basic ${credentials}` },
          timeout: 15000,
        }
      );

      const { accessToken, expiresIn } = response.data.responseBody;
      this.accessToken = accessToken;
      // Refresh 60s before actual expiry to avoid using a token that expires mid-request
      this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;

      return accessToken;
    } catch (error) {
      throw this.toMonnifyError(error, 'auth/login');
    }
  }

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private toMonnifyError(error: unknown, endpoint: string): MonnifyApiError {
    if (error instanceof AxiosError) {
      console.error('❌ Monnify API Error:', {
        endpoint,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      return new MonnifyApiError(
        error.response?.data?.responseMessage || error.message,
        error.response?.status,
        error.response?.data
      );
    }
    return new MonnifyApiError(error instanceof Error ? error.message : 'Unknown Monnify pipeline crash');
  }

  /**
   * 🔍 Validate a NUBAN account number against a bank code (Name Enquiry)
   */
  async validateAccountNumber(accountNumber: string, bankCode: string): Promise<{ accountNumber: string; accountName: string; bankCode: string }> {
    try {
      const headers = await this.authHeader();
      const response = await axios.get<MonnifyAccountValidationResponse>(
        `${MONNIFY_BASE_URL}/api/v2/disbursements/account/validate`,
        {
          params: { accountNumber, bankCode },
          headers,
          timeout: 15000,
        }
      );

      return response.data.responseBody;
    } catch (error) {
      // Monnify answers 404 "Invalid account details supplied" for an account
      // number that doesn't exist at that bank — that's a user input problem,
      // not a server fault.
      if (error instanceof AxiosError && (error.response?.status === 404 || error.response?.status === 400)) {
        throw new BadRequestError(
          'Could not find this account. Please check the bank and account number.',
          'INVALID_ACCOUNT'
        );
      }
      throw this.toMonnifyError(error, 'disbursements/account/validate');
    }
  }

  /**
   * 🚀 Create reserved (virtual) accounts for a merchant
   */
  async createReservedAccount(data: OnboardMerchantInput): Promise<{
    success: boolean;
    accountReference: string;
    accounts?: MonnifyReservedAccount[];
    error?: string;
  }> {
    const accountReference = data.merchantId;

    try {
      const headers = await this.authHeader();
      const response = await axios.post<MonnifyReservedAccountResponse>(
        `${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
        {
          accountReference,
          accountName: data.businessName,
          currencyCode: 'NGN',
          contractCode: MONNIFY_CONTRACT_CODE,
          customerEmail: data.email,
          customerName: data.ownerName,
          bvn: data.bvn,
          getAllAvailableBanks: true,
        },
        { headers, timeout: 30000 }
      );

      return {
        success: response.data.requestSuccessful,
        accountReference: response.data.responseBody.accountReference,
        accounts: response.data.responseBody.accounts,
        error: response.data.requestSuccessful ? undefined : response.data.responseMessage,
      };
    } catch (error) {
      const monnifyError = this.toMonnifyError(error, 'bank-transfer/reserved-accounts');
      return {
        success: false,
        accountReference,
        error: monnifyError.message,
      };
    }
  }

  /**
   * 💰 Get reserved account balance
   */
  async getReservedAccountBalance(accountReference: string): Promise<{ availableBalance: number; ledgerBalance: number }> {
    try {
      const headers = await this.authHeader();
      const response = await axios.get<MonnifyBalanceResponse>(
        `${MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts/balance`,
        {
          params: { accountReference },
          headers,
          timeout: 15000,
        }
      );

      return response.data.responseBody;
    } catch (error) {
      throw this.toMonnifyError(error, 'bank-transfer/reserved-accounts/balance');
    }
  }

  /**
   * 🔗 Confirm a NUBAN account is linked to the given BVN — Live-environment-only
   * (same verification family as the BVN details-match API), gated by callers
   * behind KYC_VERIFICATION_MODE.
   */
  async verifyBvnAccountMatch(bvn: string, accountNumber: string, bankCode: string): Promise<MonnifyMatchStatus> {
    try {
      const headers = await this.authHeader();
      const response = await axios.post<MonnifyBvnAccountMatchResponse>(
        `${MONNIFY_BASE_URL}/api/v1/vas/bvn-account-match`,
        { bvn, accountNumber, bankCode },
        { headers, timeout: 20000 }
      );

      if (!response.data.requestSuccessful) {
        throw new MonnifyApiError(response.data.responseMessage || 'BVN-account match failed');
      }

      return response.data.responseBody.matchStatus;
    } catch (error) {
      if (error instanceof MonnifyApiError) throw error;
      throw this.toMonnifyError(error, 'vas/bvn-account-match');
    }
  }

  /**
   * 🏦 Get list of Nigerian banks
   */
  async getBanks(): Promise<Array<{ name: string; code: string }>> {
    try {
      const headers = await this.authHeader();
      const response = await axios.get<MonnifyBanksResponse>(
        `${MONNIFY_BASE_URL}/api/v1/banks`,
        { headers, timeout: 15000 }
      );

      return response.data.responseBody;
    } catch (error) {
      throw this.toMonnifyError(error, 'banks');
    }
  }
}

// ─────────────────────────────────────────────
// CUSTOM ERROR CLASS
// ─────────────────────────────────────────────
export class MonnifyApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseData?: any
  ) {
    super(message);
    this.name = 'MonnifyApiError';
  }
}

// Singleton export
export const monnifyService = new MonnifyService();
