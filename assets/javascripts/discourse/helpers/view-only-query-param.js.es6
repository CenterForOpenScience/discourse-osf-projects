export default Ember.Helper.helper(function(params) {
    let viewOnly = params[0];
    return viewOnly ? '?view_only=' + viewOnly : '';
});
