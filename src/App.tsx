import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  ADMIN_LAST_ROUTE_KEY,
  STUDENT_LAST_ROUTE_KEY,
  getRecentLastRoute,
} from "@/lib/session-state";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const SignupPage = lazy(() => import("@/pages/SignupPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const AuthPopupCallbackPage = lazy(() => import("@/pages/AuthPopupCallbackPage"));

const StudentLayout = lazy(() => import("@/layouts/StudentLayout"));
const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));

const StudentHomePage = lazy(() => import("@/pages/student/StudentHomePage"));
const CalendarPage = lazy(() => import("@/pages/student/CalendarPage"));
const MyBookingsPage = lazy(() => import("@/pages/student/MyBookingsPage"));
const NotificationsPage = lazy(() => import("@/pages/student/NotificationsPage"));
const NotificationsHistoryPage = lazy(() => import("@/pages/student/NotificationsHistoryPage"));
const ProfilePage = lazy(() => import("@/pages/student/ProfilePage"));
const PlansPage = lazy(() => import("@/pages/student/PlansPage"));
const PlanCheckoutPage = lazy(() => import("@/pages/student/PlanCheckoutPage"));
const PlanCustomContactPage = lazy(() => import("@/pages/student/PlanCustomContactPage"));
const PlanOrdersPage = lazy(() => import("@/pages/student/PlanOrdersPage"));

const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminSlotsPage = lazy(() => import("@/pages/admin/AdminSlotsPage"));
const AdminBookingsPage = lazy(() => import("@/pages/admin/AdminBookingsPage"));
const AdminStudentsPage = lazy(() => import("@/pages/admin/AdminStudentsPage"));
const AdminBulkSchedulePage = lazy(() => import("@/pages/admin/AdminBulkSchedulePage"));
const AdminReportsPage = lazy(() => import("@/pages/admin/AdminReportsPage"));
const AdminPlansPage = lazy(() => import("@/pages/admin/AdminPlansPage"));
const AdminPlanOrdersPage = lazy(() => import("@/pages/admin/AdminPlanOrdersPage"));

const NotFound = lazy(() => import("./pages/NotFound"));

const LAST_ROUTE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const AppSuspenseFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

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

  if (profile?.role === "admin") {
    const savedAdminRoute = getRecentLastRoute(ADMIN_LAST_ROUTE_KEY, LAST_ROUTE_MAX_AGE_MS);
    return <Navigate to={savedAdminRoute || "/admin"} replace />;
  }

  const savedStudentRoute = getRecentLastRoute(STUDENT_LAST_ROUTE_KEY, LAST_ROUTE_MAX_AGE_MS);
  return <Navigate to={savedStudentRoute || "/home"} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<AppSuspenseFallback />}>
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
                <Route path="/notifications/history" element={<NotificationsHistoryPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/plans" element={<PlansPage />} />
                <Route path="/plans/orders" element={<PlanOrdersPage />} />
                <Route path="/plans/checkout/:orderId" element={<PlanCheckoutPage />} />
                <Route path="/plans/custom/:orderId" element={<PlanCustomContactPage />} />
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
                <Route path="/admin/plan-orders" element={<AdminPlanOrdersPage />} />
                <Route path="/admin/profile" element={<ProfilePage />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
