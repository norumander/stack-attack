/** TypeScript types matching the Supabase schema. */

export interface Profile {
  id: string;
  display_name: string;
  avatar_key: string;
  created_at: string;
}

export interface GameProgress {
  user_id: string;
  current_wave_index: number;
  budget: number;
  viability: number;
  completed_waves: number[];
  action_log: unknown[];
  updated_at: string;
}

export interface LeaderboardEntry {
  id: number;
  user_id: string;
  wave_id: number;
  composite_score: number;
  availability: number;
  avg_latency: number;
  final_budget: number;
  viability_remaining: number;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          display_name: string;
          avatar_key?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          avatar_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      game_progress: {
        Row: GameProgress;
        Insert: {
          user_id: string;
          current_wave_index?: number;
          budget?: number;
          viability?: number;
          completed_waves?: number[];
          action_log?: unknown[];
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          current_wave_index?: number;
          budget?: number;
          viability?: number;
          completed_waves?: number[];
          action_log?: unknown[];
          updated_at?: string;
        };
        Relationships: [];
      };
      leaderboard_entries: {
        Row: LeaderboardEntry;
        Insert: {
          id?: number;
          user_id: string;
          wave_id: number;
          composite_score?: number;
          availability?: number;
          avg_latency?: number;
          final_budget?: number;
          viability_remaining?: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          wave_id?: number;
          composite_score?: number;
          availability?: number;
          avg_latency?: number;
          final_budget?: number;
          viability_remaining?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
