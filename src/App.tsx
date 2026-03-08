import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";

// Auth pages
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import AuthPopupCallbackPage from "@/pages/AuthPopupCallbackPage";

// Layouts
import StudentLayout from "@/layouts/StudentLayout";
import AdminLayout from "@/layouts/AdminLayout";

// Student pages
import StudentHomePage from "@/pages/student/StudentHomePage";
import CalendarPage from "@/pages/student/CalendarPage";
import MyBookingsPage from "@/pages/student/MyBookingsPage";
import NotificationsPage from "@/pages/student/NotificationsPage";
import ProfilePage from "@/pages/student/ProfilePage";
import PlansPage from "@/pages/student/PlansPage";

// Admin pages
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminSlotsPage from "@/pages/admin/AdminSlotsPage";
import AdminBookingsPage from "@/pages/admin/AdminBookingsPage";
import AdminStudentsPage from "@/pages/admin/AdminStudentsPage";
import AdminBulkSchedulePage from "@/pages/admin/AdminBulkSchedulePage";
import AdminReportsPage from "@/pages/admin/AdminReportsPage";
import AdminPlansPage from "@/pages/admin/AdminPlansPage";

import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const HomeRedirect = () => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/home" replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/popup-callback" element={<AuthPopupCallbackPage />} />

            {/* Student */}
            <Route element={<ProtectedRoute><StudentLayout /></ProtectedRoute>}>
              <Route path="/home" element={<StudentHomePage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/my-bookings" element={<MyBookingsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/plans" element={<PlansPage />} />
            </Route>

            {/* Admin */}
            <Route element={<ProtectedRoute requireAdmin><AdminLayout /></ProtectedRoute>}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/slots" element={<AdminSlotsPage />} />
              <Route path="/admin/bookings" element={<AdminBookingsPage />} />
              <Route path="/admin/students" element={<AdminStudentsPage />} />
              <Route path="/admin/bulk-schedule" element={<AdminBulkSchedulePage />} />
              <Route path="/admin/reports" element={<AdminReportsPage />} />
              <Route path="/admin/plans" element={<AdminPlansPage />} />
              <Route path="/admin/profile" element={<ProfilePage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
