import axios from 'axios';
import { getApiBase } from './apiBase';

export interface GPTAccount {
  id: number;
  email: string;
  password?: string;
  access_token: string;
  refresh_token: string;
  id_token: string;
  account_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface GPTJob {
  id: number;
  total_count: number;
  success_count: number;
  fail_count: number;
  status: 'pending' | 'running' | 'completed' | 'partially_completed' | 'failed';
  logs: string; // JSON string array
  created_at: string;
  updated_at: string;
}

const API_BASE = `${getApiBase()}/gpt`;

export const gptService = {
  /**
   * 获取账号列表
   */
  async getAccounts(): Promise<GPTAccount[]> {
    const sessionId = localStorage.getItem('seedance_session_id');
    const response = await axios.get(`${API_BASE}/accounts`, {
      headers: { 'X-Session-ID': sessionId }
    });
    return response.data;
  },

  /**
   * 获取任务列表
   */
  async getJobs(): Promise<GPTJob[]> {
    const sessionId = localStorage.getItem('seedance_session_id');
    const response = await axios.get(`${API_BASE}/jobs`, {
      headers: { 'X-Session-ID': sessionId }
    });
    return response.data;
  },

  /**
   * 获取任务详情
   */
  async getJob(id: number): Promise<GPTJob> {
    const sessionId = localStorage.getItem('seedance_session_id');
    const response = await axios.get(`${API_BASE}/jobs/${id}`, {
      headers: { 'X-Session-ID': sessionId }
    });
    return response.data;
  },

  /**
   * 启动批量注册任务
   */
  async registerBatch(count: number): Promise<{ jobId: number }> {
    const sessionId = localStorage.getItem('seedance_session_id');
    const response = await axios.post(`${API_BASE}/register-batch`, { count }, {
      headers: { 'X-Session-ID': sessionId }
    });
    return response.data;
  },

  /**
   * 停止任务
   */
  async stopJob(id: number): Promise<void> {
    const sessionId = localStorage.getItem('seedance_session_id');
    await axios.post(`${API_BASE}/jobs/${id}/stop`, {}, {
      headers: { 'X-Session-ID': sessionId }
    });
  },

  /**
   * 删除任务
   */
  async deleteJob(id: number): Promise<void> {
    const sessionId = localStorage.getItem('seedance_session_id');
    await axios.delete(`${API_BASE}/jobs/${id}`, {
      headers: { 'X-Session-ID': sessionId }
    });
  }
};

export default gptService;
