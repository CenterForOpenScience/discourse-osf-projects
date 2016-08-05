/*jshint esversion: 6*/

export default {
  name: 'project-route-builder',
  initialize(container, app) {
    const site = container.lookup('site:main');
    const ProjectsShowRoute = container.lookupFactory('route:projects-show');

    app.ProjectsShowCategoryRoute = ProjectsShowRoute.extend();
    app.ProjectsShowParentCategoryRoute = ProjectsShowRoute.extend();

    site.get('filters').forEach(function(filter) {
      app["ProjectsShow" + filter.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: filter });
      app["ProjectsShowCategory" + filter.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: filter });
      app["ProjectsShowParentCategory" + filter.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: filter });
    });

    app.ProjectsTopRoute = ProjectsShowRoute.extend({ navMode: 'top' });
    app.ProjectsTopCategoryRoute = ProjectsShowRoute.extend({ navMode: 'top' });
    app.ProjectsTopParentCategoryRoute = ProjectsShowRoute.extend({ navMode: 'top'});

    site.get('periods').forEach(period => {
      app["ProjectsTop" + period.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: 'top', period: period });
      app["ProjectsTopCategory" + period.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: 'top', period: period });
      app["ProjectsTopParentCategory" + period.capitalize() + "Route"] = ProjectsShowRoute.extend({ navMode: 'top', period: period });
    });
  }
};
