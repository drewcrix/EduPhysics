#include "osim/sensors/basic_sensors.hpp"

#include "osim/estimators/covariance_utils.hpp"
#include "osim/frames/attitude.hpp"

namespace osim {

// GNSS position ------------------------------------------------------------

GnssPositionSensor::GnssPositionSensor(SensorConfig cfg) : Sensor(std::move(cfg)) { check_noise_dims(); }

std::vector<ComponentLabel> GnssPositionSensor::labels() const {
  return {{"x", "m", Quantity::Position}, {"y", "m", Quantity::Position}, {"z", "m", Quantity::Position}};
}

Vec GnssPositionSensor::h(double, const Vec& x) const { return x.head<3>(); }

Mat GnssPositionSensor::H(double, const Vec& x) const {
  Mat H = Mat::Zero(3, x.size());
  H.block<3, 3>(0, 0) = Mat3::Identity();
  return H;
}

// GNSS position + velocity ---------------------------------------------------

GnssPositionVelocitySensor::GnssPositionVelocitySensor(SensorConfig cfg) : Sensor(std::move(cfg)) {
  check_noise_dims();
}

std::vector<ComponentLabel> GnssPositionVelocitySensor::labels() const {
  return {{"x", "m", Quantity::Position},    {"y", "m", Quantity::Position},
          {"z", "m", Quantity::Position},    {"vx", "m/s", Quantity::Velocity},
          {"vy", "m/s", Quantity::Velocity}, {"vz", "m/s", Quantity::Velocity}};
}

Vec GnssPositionVelocitySensor::h(double, const Vec& x) const { return x.head<6>(); }

Mat GnssPositionVelocitySensor::H(double, const Vec& x) const {
  Mat H = Mat::Zero(6, x.size());
  H.block(0, 0, 6, 6).setIdentity();
  return H;
}

// Gyroscope ------------------------------------------------------------------

GyroSensor::GyroSensor(SensorConfig cfg, Vec3 true_bias) : Sensor(std::move(cfg)), bias_(true_bias) {
  check_noise_dims();
}

std::vector<ComponentLabel> GyroSensor::labels() const {
  return {{"ωx", "rad/s", Quantity::AngularRate},
          {"ωy", "rad/s", Quantity::AngularRate},
          {"ωz", "rad/s", Quantity::AngularRate}};
}

std::string GyroSensor::unsupported_reason(const DynamicsModel& model) const {
  if (!model.has_attitude())
    return "A gyroscope measures body angular rates, but the " + model.name() +
           " model has no attitude states. Switch to the 12-state rigid-body model to use it.";
  return {};
}

Vec GyroSensor::h(double, const Vec& x) const { return x.segment<3>(9); }

Mat GyroSensor::H(double, const Vec& x) const {
  Mat H = Mat::Zero(3, x.size());
  H.block<3, 3>(0, 9) = Mat3::Identity();
  return H;
}

Vec GyroSensor::simulate(double t, const Vec& x_true, Rng& rng) const {
  return Sensor::simulate(t, x_true, rng) + bias_;
}

// Star tracker -----------------------------------------------------------------

StarTrackerSensor::StarTrackerSensor(SensorConfig cfg) : Sensor(std::move(cfg)) { check_noise_dims(); }

std::vector<ComponentLabel> StarTrackerSensor::labels() const {
  return {{"φ (roll)", "rad", Quantity::Angle}, {"θ (pitch)", "rad", Quantity::Angle}, {"ψ (yaw)", "rad", Quantity::Angle}};
}

std::string StarTrackerSensor::unsupported_reason(const DynamicsModel& model) const {
  if (!model.has_attitude())
    return "A star tracker measures attitude, but the " + model.name() +
           " model has no attitude states. Switch to the 12-state rigid-body model to use it.";
  return {};
}

Vec StarTrackerSensor::h(double, const Vec& x) const { return x.segment<3>(6); }

Mat StarTrackerSensor::H(double, const Vec& x) const {
  Mat H = Mat::Zero(3, x.size());
  H.block<3, 3>(0, 6) = Mat3::Identity();
  return H;
}

Vec StarTrackerSensor::simulate(double, const Vec& x_true, Rng& rng) const {
  // Small body-frame rotation error, applied to the true attitude, then read out as Euler angles
  const Mat L = cov::safe_cholesky(cfg_.R_true);
  const Vec3 dtheta = rng.gaussian(L);
  const Mat3 C = attitude::euler_to_dcm(x_true.segment<3>(6)) * attitude::so3_exp(dtheta);
  return attitude::dcm_to_euler(C);
}

Mat StarTrackerSensor::filter_covariance(const Vec& x_est) const {
  const Mat3 W = attitude::euler_rate_matrix(x_est.segment<3>(6));
  return cov::symmetrize(W * cfg_.R_assumed * W.transpose());
}

}  // namespace osim
