#include "osim/simulation/scenario.hpp"

#include "osim/constants.hpp"
#include "osim/dynamics/cw_dynamics.hpp"
#include "osim/dynamics/orbital_dynamics.hpp"
#include "osim/dynamics/rigid_spacecraft_dynamics.hpp"
#include "osim/estimators/covariance_utils.hpp"
#include "osim/estimators/estimator_registry.hpp"
#include "osim/frames/frames.hpp"
#include "osim/simulation/json_util.hpp"

#include <cmath>
#include <fstream>

namespace osim {

using json_util::json;
using json_util::value_or;

namespace {

int state_dim_of(const std::string& kind) { return kind == "rigid12" ? 12 : 6; }
int noise_dim_of(const std::string& kind) { return kind == "rigid12" ? 6 : 3; }
int control_dim_of(const std::string& kind) { return kind == "rigid12" ? 4 : 3; }

void read_model_overrides(const json& j, ModelSpec& m) {
  if (j.contains("mu")) m.mu = j.at("mu").get<double>();
  if (j.contains("integrator")) {
    const auto& ij = j.at("integrator");
    m.integrator.method = parse_integrator(value_or<std::string>(ij, "method", to_string(m.integrator.method)));
    m.integrator.max_step = value_or(ij, "maxStep", m.integrator.max_step);
  }
  if (j.contains("spacecraft")) {
    const auto& s = j.at("spacecraft");
    m.mass = value_or(s, "mass", m.mass);
    m.radius = value_or(s, "radius", m.radius);
    if (s.contains("inertia")) m.inertia = json_util::get_vec(s.at("inertia"), 3, "spacecraft inertia");
  }
  if (j.contains("cwMeanMotion")) m.cw_mean_motion = j.at("cwMeanMotion").get<double>();
}

Mat read_psd(const json& j, const std::string& kind, const std::string& what) {
  const int p = noise_dim_of(kind);
  if (j.contains("processNoiseCovariance")) return json_util::get_mat(j.at("processNoiseCovariance"), p, what);
  if (j.contains("processNoisePsd")) return json_util::get_vec(j.at("processNoisePsd"), p, what).asDiagonal();
  return Mat::Zero(p, p);
}

Vec3 read_vec3(const json& j, const char* key, const Vec3& fallback) {
  return j.contains(key) ? Vec3(json_util::get_vec(j.at(key), 3, key)) : fallback;
}

Vec initial_true_state(const json& j, const ModelSpec& m) {
  const int n = state_dim_of(m.kind);
  Vec x = Vec::Zero(n);
  const std::string type = value_or<std::string>(j, "type", "cartesian");
  if (type == "cartesian") {
    return json_util::get_vec(j.at("x"), n, "initial state x");
  }
  if (m.kind == "cw6") throw ConfigError("The CW lab needs a cartesian initial state.");
  frames::KeplerianElements k;
  if (type == "circular") {
    k.a = constants::R_EARTH + j.at("altitudeM").get<double>();
    k.e = 0.0;
    k.i = value_or(j, "inclinationDeg", 0.0) * constants::DEG;
    k.raan = value_or(j, "raanDeg", 0.0) * constants::DEG;
    k.argp = 0.0;
    k.nu = value_or(j, "argLatDeg", 0.0) * constants::DEG;
  } else if (type == "keplerian") {
    k.a = j.at("aM").get<double>();
    k.e = value_or(j, "e", 0.0);
    k.i = value_or(j, "iDeg", 0.0) * constants::DEG;
    k.raan = value_or(j, "raanDeg", 0.0) * constants::DEG;
    k.argp = value_or(j, "argpDeg", 0.0) * constants::DEG;
    k.nu = value_or(j, "nuDeg", 0.0) * constants::DEG;
  } else {
    throw ConfigError("Unknown initial state type '" + type + "' (cartesian, circular, keplerian).");
  }
  x.head<6>() = frames::keplerian_to_cartesian(k, m.mu);
  if (m.kind == "rigid12") {
    x.segment<3>(6) = read_vec3(j, "eulerRad", Vec3::Zero());
    x.segment<3>(9) = read_vec3(j, "omegaRadS", Vec3::Zero());
  }
  return x;
}

ControlSpec parse_controls(const json& j, const std::string& kind) {
  ControlSpec c;
  const int m = control_dim_of(kind);
  c.telemetry_sigma_true = Vec::Zero(m);
  if (j.is_null()) return c;
  c.true_scale_error = value_or(j, "trueScaleError", 0.0);
  if (j.contains("telemetrySigmaTrue")) c.telemetry_sigma_true = json_util::get_vec(j.at("telemetrySigmaTrue"), m, "telemetrySigmaTrue");
  c.estimator_knows_thrust = value_or(j, "estimatorKnowsThrust", true);
  if (j.contains("segments"))
    for (const auto& s : j.at("segments")) {
      ThrustSegment seg;
      seg.label = value_or<std::string>(s, "label", "thrust arc");
      seg.start = s.at("start").get<double>();
      seg.end = s.at("end").get<double>();
      if (!(seg.end > seg.start)) throw ConfigError("Thrust segment '" + seg.label + "' must end after it starts.");
      seg.thrust = value_or(s, "thrustN", 0.0);
      seg.frame = value_or<std::string>(s, "frame", kind == "cw6" ? "LVLH" : "RTN");
      seg.direction = read_vec3(s, "direction", Vec3::UnitY());
      if (seg.direction.norm() == 0.0) throw ConfigError("Thrust direction must be non-zero.");
      seg.direction.normalize();
      seg.torque = read_vec3(s, "torqueNm", Vec3::Zero());
      seg.torque_amplitude = read_vec3(s, "torqueAmplitudeNm", Vec3::Zero());
      seg.torque_omega = read_vec3(s, "torqueOmegaRadS", Vec3::Zero());
      c.segments.push_back(seg);
    }
  if (j.contains("impulses"))
    for (const auto& s : j.at("impulses")) {
      ImpulseEvent e;
      e.label = value_or<std::string>(s, "label", "burn");
      e.t = s.at("t").get<double>();
      e.dv = json_util::get_vec(s.at("dv"), 3, "impulse dv");
      e.frame = value_or<std::string>(s, "frame", kind == "cw6" ? "LVLH" : "RTN");
      e.known = value_or(s, "known", true);
      e.true_magnitude_error = value_or(s, "trueMagnitudeError", 0.0);
      e.true_pointing_error = value_or(s, "truePointingErrorDeg", 0.0) * constants::DEG;
      e.true_sigma = read_vec3(s, "trueSigma", Vec3::Zero());
      e.assumed_sigma = read_vec3(s, "assumedSigma", e.true_sigma);
      c.impulses.push_back(e);
    }
  return c;
}

}  // namespace

DynamicsModelPtr build_model(const ModelSpec& spec) {
  std::vector<ForceModelPtr> forces{std::make_shared<PointMassGravity>(spec.mu)};
  if (spec.kind == "orbit6") return std::make_shared<OrbitalDynamics>(forces);
  if (spec.kind == "rigid12") {
    RigidBodyParameters p = sphere_parameters(spec.mass, spec.radius);
    if (spec.inertia.norm() > 0.0) p.inertia = spec.inertia;
    return std::make_shared<RigidSpacecraftDynamics>(forces, p);
  }
  if (spec.kind == "cw6") return std::make_shared<ClohessyWiltshireDynamics>(spec.cw_mean_motion);
  throw ConfigError("Unknown model '" + spec.kind + "' (use orbit6, rigid12 or cw6).");
}

EstimatorSpec parse_estimator_spec(const json& j, const ModelSpec& truth, const Vec& x0_true) {
  EstimatorSpec e;
  const int n = state_dim_of(truth.kind);
  const int m = control_dim_of(truth.kind);
  e.type = value_or<std::string>(j, "type", "ekf");
  if (!EstimatorRegistry::instance().has(e.type)) throw ConfigError("Unknown estimator type '" + e.type + "'.");
  e.model = truth;  // the estimator's model matches truth unless overridden
  if (j.contains("model")) read_model_overrides(j.at("model"), e.model);
  e.model.Qc = read_psd(j, truth.kind, "estimator process-noise PSD");

  if (j.contains("initialEstimate"))
    e.x0 = json_util::get_vec(j.at("initialEstimate"), n, "initialEstimate");
  else
    e.x0 = x0_true + (j.contains("initialError") ? json_util::get_vec(j.at("initialError"), n, "initialError")
                                                 : Vec::Zero(n));
  if (!json_util::read_covariance(j, "initial", n, "initial covariance P0", e.P0))
    throw ConfigError("The estimator needs \"initialSigma\" or \"initialCovariance\".");
  auto chk = cov::validate(e.P0, n, "Initial covariance P0", true);
  if (!chk.ok) throw ConfigError(chk.message);

  auto& s = e.settings;
  s.integrator = e.model.integrator;
  s.Qc = e.model.Qc;
  s.Sigma_u = j.contains("controlNoiseSigma")
                  ? Mat(json_util::get_vec(j.at("controlNoiseSigma"), m, "controlNoiseSigma").cwiseAbs2().asDiagonal())
                  : Mat::Zero(m, m);
  s.seed = value_or<std::uint64_t>(j, "seed", 7);
  if (j.contains("ukf")) {
    const auto& u = j.at("ukf");
    s.ukf.alpha = value_or(u, "alpha", s.ukf.alpha);
    s.ukf.beta = value_or(u, "beta", s.ukf.beta);
    s.ukf.kappa = value_or(u, "kappa", s.ukf.kappa);
  }
  if (j.contains("pf")) {
    const auto& p = j.at("pf");
    s.pf.particles = value_or(p, "particles", s.pf.particles);
    s.pf.resample_threshold = value_or(p, "resampleThreshold", s.pf.resample_threshold);
    s.pf.roughening = value_or(p, "roughening", s.pf.roughening);
    s.pf.roughening_scale = value_or(p, "rougheningScale", s.pf.roughening_scale);
  }
  if (j.contains("kf")) {
    const std::string lin = value_or<std::string>(j.at("kf"), "linearization", "reference");
    if (lin == "reference")
      s.kf_linearization = KfLinearization::Reference;
    else if (lin == "frozen")
      s.kf_linearization = KfLinearization::Frozen;
    else
      throw ConfigError("KF linearization must be \"reference\" or \"frozen\".");
  }
  return e;
}

Scenario parse_scenario(const json& j) {
  Scenario sc;
  sc.raw = j;
  if (value_or(j, "schemaVersion", 1) != 1) throw ConfigError("Unsupported scenario schemaVersion (expected 1).");
  sc.id = j.at("id").get<std::string>();
  sc.name = value_or<std::string>(j, "name", sc.id);
  sc.description = value_or<std::string>(j, "description", "");
  sc.seed = value_or<std::uint64_t>(j, "seed", 1);
  sc.epoch = value_or<std::string>(j, "epoch", sc.epoch);
  sc.theta_g0 = value_or(j, "greenwichAngleAtEpochDeg", 0.0) * constants::DEG;
  sc.duration = j.at("duration").get<double>();
  sc.dt = j.at("dt").get<double>();
  if (!(sc.duration > 0.0) || !(sc.dt > 0.0)) throw ConfigError("duration and dt must be positive.");
  if (sc.duration / sc.dt > 2e5) throw ConfigError("duration/dt is too large (more than 200 000 output steps).");

  const json& tj = j.at("truth");
  sc.truth.kind = value_or<std::string>(j, "model", "orbit6");
  sc.truth.integrator.max_step = sc.dt;
  read_model_overrides(tj, sc.truth);
  if (sc.truth.kind == "cw6" && !(sc.truth.cw_mean_motion > 0.0)) {
    // Default chief orbit: circular at the given altitude
    const double a = constants::R_EARTH + value_or(tj, "chiefAltitudeM", 550e3);
    sc.truth.cw_mean_motion = std::sqrt(sc.truth.mu / (a * a * a));
  }
  sc.truth.Qc = read_psd(tj, sc.truth.kind, "true process-noise PSD");
  auto chk = cov::validate(sc.truth.Qc, noise_dim_of(sc.truth.kind), "True process-noise PSD", false);
  if (!chk.ok) throw ConfigError(chk.message);
  sc.x0_true = initial_true_state(tj.at("initialState"), sc.truth);
  if (sc.truth.kind != "cw6" && sc.x0_true.head<3>().norm() < constants::R_EARTH)
    throw ConfigError("The initial position is inside the Earth.");

  sc.controls = parse_controls(j.contains("controls") ? j.at("controls") : json(), sc.truth.kind);
  sc.estimator = parse_estimator_spec(j.at("estimator"), sc.truth, sc.x0_true);
  if (!j.contains("sensors") || !j.at("sensors").is_array()) throw ConfigError("A scenario needs a \"sensors\" list.");
  return sc;
}

Scenario load_scenario_file(const std::string& path) {
  std::ifstream f(path);
  if (!f) throw ConfigError("Cannot open scenario file " + path);
  json j;
  try {
    f >> j;
  } catch (const json::exception& e) {
    throw ConfigError("Scenario file " + path + " is not valid JSON: " + e.what());
  }
  return parse_scenario(j);
}

}  // namespace osim
