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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      availability_slots: {
        Row: {
          capacity: number
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          notes: string | null
          start_time: string
          status: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          notes?: string | null
          start_time: string
          status?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          start_time?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          attendance_status: string
          checked_in_at: string | null
          checked_in_by: string | null
          created_at: string
          created_by_admin: boolean
          id: string
          seats_reserved: number
          slot_id: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          attendance_status?: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          created_by_admin?: boolean
          id?: string
          seats_reserved: number
          slot_id: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          attendance_status?: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          created_at?: string
          created_by_admin?: boolean
          id?: string
          seats_reserved?: number
          slot_id?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_plans: {
        Row: {
          created_at: string
          credits: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          price_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price_cents: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          read: boolean
          title: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          title?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          title?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: string
        }
        Relationships: []
      }
      student_month_credits: {
        Row: {
          created_at: string
          id: string
          month_ref: string
          monthly_limit: number
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          month_ref: string
          monthly_limit?: number
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          month_ref?: string
          monthly_limit?: number
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_month_credits_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_plan_selections: {
        Row: {
          credits: number
          id: string
          month_ref: string
          plan_id: string
          price_cents: number
          selected_at: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          credits: number
          id?: string
          month_ref: string
          plan_id: string
          price_cents: number
          selected_at?: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          credits?: number
          id?: string
          month_ref?: string
          plan_id?: string
          price_cents?: number
          selected_at?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_plan_selections_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "lesson_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_plan_selections_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          notified_at: string | null
          position: number
          slot_id: string
          status: string
          student_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notified_at?: string | null
          position: number
          slot_id: string
          status?: string
          student_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notified_at?: string | null
          position?: number
          slot_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_bulk_book: {
        Args: {
          p_seats_reserved_default?: number
          p_slot_ids: string[]
          p_student_id: string
        }
        Returns: Json
      }
      admin_check_in: {
        Args: { p_attendance_status: string; p_booking_id: string }
        Returns: undefined
      }
      book_slot: {
        Args: { p_seats_reserved: number; p_slot_id: string }
        Returns: string
      }
      choose_plan: {
        Args: { p_month_ref?: string; p_plan_id: string }
        Returns: string
      }
      cancel_booking: { Args: { p_booking_id: string }; Returns: undefined }
      get_month_ref: { Args: { ts: string }; Returns: string }
      get_month_report: { Args: { p_month_ref: string }; Returns: Json }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      process_waitlist: { Args: { p_slot_id: string }; Returns: undefined }
      reschedule_booking: {
        Args: { p_booking_id: string; p_new_slot_id: string }
        Returns: undefined
      }
      waitlist_accept: { Args: { p_waitlist_id: string }; Returns: string }
      waitlist_join: { Args: { p_slot_id: string }; Returns: string }
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
