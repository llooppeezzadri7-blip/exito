import { MOCK_BUSINESSES, MOCK_JOBS, MOCK_LEADS, MOCK_SCORES } from "./mock-data";
import type { AiReport, ApiUsage, Business, Demo, Job, Lead, LeadActivity, Proposal, Score, WebsiteScan } from "./types";

/**
 * Mutable, process-local copy of the fixtures — lets the mock provider
 * actually accept CSV imports / job creation during a dev session (resets
 * on server restart, since there's no real database behind it). Real
 * persistence is the Supabase provider's job.
 */
class MockStore {
  businesses: Business[] = [...MOCK_BUSINESSES];
  scores: Score[] = [...MOCK_SCORES];
  leads: Lead[] = [...MOCK_LEADS];
  jobs: Job[] = [...MOCK_JOBS];
  websiteScans: WebsiteScan[] = [];
  aiReports: AiReport[] = [];
  leadActivities: LeadActivity[] = [];
  proposals: Proposal[] = [];
  demos: Demo[] = [];
  apiUsage: ApiUsage[] = [];
}

const globalForMockStore = globalThis as unknown as { __mockStore?: MockStore };

export const mockStore = globalForMockStore.__mockStore ?? new MockStore();
globalForMockStore.__mockStore = mockStore;
