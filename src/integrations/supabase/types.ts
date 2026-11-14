export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string
          id: string
          is_current: boolean
          name: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_current?: boolean
          name: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_current?: boolean
          name?: string
          teacher_id?: string
        }
        Relationships: []
      }
      ai_usage_events: {
        Row: {
          created_at: string
          id: string
          teacher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          teacher_id?: string
        }
        Relationships: []
      }
      ai_drafts: {
        Row: {
          assessment_id: string | null
          comment_type: string | null
          content: string
          created_at: string
          draft_type: string
          id: string
          is_edited: boolean
          learner_id: string
          message_type: string | null
          teacher_id: string
          term_period_id: string | null
          updated_at: string
        }
        Insert: {
          assessment_id?: string | null
          comment_type?: string | null
          content: string
          created_at?: string
          draft_type: string
          id?: string
          is_edited?: boolean
          learner_id: string
          message_type?: string | null
          teacher_id: string
          term_period_id?: string | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string | null
          comment_type?: string | null
          content?: string
          created_at?: string
          draft_type?: string
          id?: string
          is_edited?: boolean
          learner_id?: string
          message_type?: string | null
          teacher_id?: string
          term_period_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_drafts_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_term_period_id_fkey"
            columns: ["term_period_id"]
            isOneToOne: false
            referencedRelation: "term_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          academic_year_id: string | null
          assessment_date: string
          assessment_type: string
          capture_mode: string
          category: string | null
          class_id: string
          counts_towards_report: boolean
          created_at: string
          grade: string | null
          id: string
          name: string
          pass_mark: number
          sections: Json
          subject: string | null
          teacher_id: string
          term_period_id: string | null
          topics_covered: string | null
          total_marks: number
          updated_at: string
          weighting: number | null
        }
        Insert: {
          academic_year_id?: string | null
          assessment_date?: string
          assessment_type?: string
          capture_mode?: string
          category?: string | null
          class_id: string
          counts_towards_report?: boolean
          created_at?: string
          grade?: string | null
          id?: string
          name: string
          pass_mark?: number
          sections?: Json
          subject?: string | null
          teacher_id: string
          term_period_id?: string | null
          topics_covered?: string | null
          total_marks: number
          updated_at?: string
          weighting?: number | null
        }
        Update: {
          academic_year_id?: string | null
          assessment_date?: string
          assessment_type?: string
          capture_mode?: string
          category?: string | null
          class_id?: string
          counts_towards_report?: boolean
          created_at?: string
          grade?: string | null
          id?: string
          name?: string
          pass_mark?: number
          sections?: Json
          subject?: string | null
          teacher_id?: string
          term_period_id?: string | null
          topics_covered?: string | null
          total_marks?: number
          updated_at?: string
          weighting?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_term_period_id_fkey"
            columns: ["term_period_id"]
            isOneToOne: false
            referencedRelation: "term_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          grade: string
          id: string
          name: string
          subject: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          grade: string
          id?: string
          name: string
          subject: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          grade?: string
          id?: string
          name?: string
          subject?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      feedback_submissions: {
        Row: {
          app_version: string | null
          browser: string | null
          category: string | null
          id: string
          message: string | null
          page: string | null
          plan: string | null
          received_at: string
          teacher_id: string | null
        }
        Insert: {
          app_version?: string | null
          browser?: string | null
          category?: string | null
          id?: string
          message?: string | null
          page?: string | null
          plan?: string | null
          received_at?: string
          teacher_id?: string | null
        }
        Update: {
          app_version?: string | null
          browser?: string | null
          category?: string | null
          id?: string
          message?: string | null
          page?: string | null
          plan?: string | null
          received_at?: string
          teacher_id?: string | null
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          class_id: string
          file_name: string | null
          id: string
          import_method: string
          imported_at: string
          learners_added: number
          learners_archived: number
          rows_imported: number
          rows_skipped: number
          rows_total: number
          teacher_id: string
        }
        Insert: {
          class_id: string
          file_name?: string | null
          id?: string
          import_method: string
          imported_at?: string
          learners_added?: number
          learners_archived?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          teacher_id: string
        }
        Update: {
          class_id?: string
          file_name?: string | null
          id?: string
          import_method?: string
          imported_at?: string
          learners_added?: number
          learners_archived?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_logs_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      learners: {
        Row: {
          active: boolean
          aliases: string[]
          class_id: string
          created_at: string
          id: string
          name: string
          pronouns: string | null
          pronunciation: string | null
          pronunciation_audio_path: string | null
          sort_key: string | null
          teacher_id: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          class_id: string
          created_at?: string
          id?: string
          name: string
          pronouns?: string | null
          pronunciation?: string | null
          pronunciation_audio_path?: string | null
          sort_key?: string | null
          teacher_id: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          class_id?: string
          created_at?: string
          id?: string
          name?: string
          pronouns?: string | null
          pronunciation?: string | null
          pronunciation_audio_path?: string | null
          sort_key?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learners_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      mark_history: {
        Row: {
          changed_at: string
          id: string
          mark_id: string
          new_mark: number | null
          new_status: string | null
          old_mark: number | null
          old_status: string | null
          teacher_id: string
        }
        Insert: {
          changed_at?: string
          id?: string
          mark_id: string
          new_mark?: number | null
          new_status?: string | null
          old_mark?: number | null
          old_status?: string | null
          teacher_id: string
        }
        Update: {
          changed_at?: string
          id?: string
          mark_id?: string
          new_mark?: number | null
          new_status?: string | null
          old_mark?: number | null
          old_status?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mark_history_mark_id_fkey"
            columns: ["mark_id"]
            isOneToOne: false
            referencedRelation: "marks"
            referencedColumns: ["id"]
          },
        ]
      }
      marks: {
        Row: {
          assessment_id: string
          created_at: string
          id: string
          learner_id: string
          mark: number | null
          section_marks: Json | null
          status: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          id?: string
          learner_id: string
          mark?: number | null
          section_marks?: Json | null
          status?: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          id?: string
          learner_id?: string
          mark?: number | null
          section_marks?: Json | null
          status?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marks_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "learners"
            referencedColumns: ["id"]
          },
        ]
      }
      school_enquiries: {
        Row: {
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
          province: string
          role: string
          school_name: string
          submitted_at: string
          teacher_count: string
        }
        Insert: {
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          province: string
          role: string
          school_name: string
          submitted_at?: string
          teacher_count: string
        }
        Update: {
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          province?: string
          role?: string
          school_name?: string
          submitted_at?: string
          teacher_count?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          data_deletion_scheduled_at: string | null
          first_payment_completed: boolean
          id: string
          payfast_subscription_token: string | null
          plan: string
          last_payfast_payment_id: string | null
          status: string
          teacher_id: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          data_deletion_scheduled_at?: string | null
          first_payment_completed?: boolean
          id?: string
          payfast_subscription_token?: string | null
          plan: string
          last_payfast_payment_id?: string | null
          status: string
          teacher_id: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          data_deletion_scheduled_at?: string | null
          first_payment_completed?: boolean
          id?: string
          payfast_subscription_token?: string | null
          plan?: string
          last_payfast_payment_id?: string | null
          status?: string
          teacher_id?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      teacher_settings: {
        Row: {
          comment_length_sentences: string
          comment_length_type: string
          comment_length_words: number | null
          created_at: string
          id: string
          learner_term: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          comment_length_sentences?: string
          comment_length_type?: string
          comment_length_words?: number | null
          created_at?: string
          id?: string
          learner_term?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          comment_length_sentences?: string
          comment_length_type?: string
          comment_length_words?: number | null
          created_at?: string
          id?: string
          learner_term?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      term_periods: {
        Row: {
          academic_year_id: string
          created_at: string
          end_date: string | null
          id: string
          name: string
          sort_order: number
          start_date: string | null
          teacher_id: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          sort_order: number
          start_date?: string | null
          teacher_id: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          sort_order?: number
          start_date?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_periods_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          action_taken: string | null
          id: string
          payload: Json | null
          received_at: string
          verified: boolean
        }
        Insert: {
          action_taken?: string | null
          id?: string
          payload?: Json | null
          received_at?: string
          verified?: boolean
        }
        Update: {
          action_taken?: string | null
          id?: string
          payload?: Json | null
          received_at?: string
          verified?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      check_ai_rate_limit: {
        Args: {
          p_teacher: string
          p_limit?: number
          p_window_seconds?: number
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
